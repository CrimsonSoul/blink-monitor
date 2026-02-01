use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::rustls::{
    self, 
    ClientConfig, 
    DigitallySignedStruct, 
    Error as RustlsError, 
    SignatureScheme
};
use tokio_rustls::rustls::client::danger::{
    HandshakeSignatureValid, 
    ServerCertVerified, 
    ServerCertVerifier
};
use rustls_pki_types::{CertificateDer, ServerName, UnixTime};
use tokio_rustls::TlsConnector;
use anyhow::{Result, anyhow};
use url::Url;
use bytes::{BytesMut, BufMut};

#[derive(Debug)]
struct NoCertificateVerification;

impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::aws_lc_rs::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub struct ImmiStream {
    pub reader: tokio::io::ReadHalf<tokio_rustls::client::TlsStream<TcpStream>>,
    pub writer: tokio::io::WriteHalf<tokio_rustls::client::TlsStream<TcpStream>>,
}

impl ImmiStream {
    pub async fn connect(server_url: &str, serial: &str) -> Result<Self> {
        let fixed_url = server_url.replace("immis://", "https://");
        let url = Url::parse(&fixed_url)?;
        
        let host = url.host_str().ok_or(anyhow!("Invalid host"))?;
        let port = url.port().unwrap_or(443);
        let path = url.path();
        
        let client_id = url.query_pairs()
            .find(|(k, _)| k == "client_id")
            .map(|(_, v)| v.to_string())
            .unwrap_or_else(|| "0".to_string());
            
        let conn_id = path.split('/')
            .last()
            .and_then(|s| s.split("__").next())
            .ok_or(anyhow!("Could not extract connection ID"))?;

        // TLS Setup with disabled verification
        let provider = rustls::crypto::aws_lc_rs::default_provider();
        let config = ClientConfig::builder_with_provider(Arc::new(provider))
            .with_safe_default_protocol_versions()?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
            .with_no_client_auth();
            
        let connector = TlsConnector::from(Arc::new(config));
        let stream = TcpStream::connect(format!("{}:{}", host, port)).await?;
        let domain = ServerName::try_from(host.to_string())
            .map_err(|_| anyhow!("Invalid DNS name"))?;
            
        let tls_stream = connector.connect(domain, stream).await?;
        let (reader, mut writer) = tokio::io::split(tls_stream);

        // Build the 122-byte authentication header matching reference blinkpy implementation
        let mut auth_header = BytesMut::with_capacity(122);
        
        // 1. Magic number (4 bytes)
        auth_header.put_u32(0x00000028);
        
        // 2. Device Serial field (4-byte length prefix + 16 serial bytes)
        let serial_bytes = serial.as_bytes();
        let serial_len = serial_bytes.len().min(16);
        auth_header.put_u32(16);
        auth_header.put_slice(&serial_bytes[..serial_len]);
        if serial_len < 16 {
            auth_header.put_bytes(0, 16 - serial_len);
        }
        
        // 3. Client ID field (4 bytes)
        let cid: u32 = client_id.parse().unwrap_or(0);
        auth_header.put_u32(cid);
        
        // 4. Static field (2 bytes)
        auth_header.put_slice(&[0x01, 0x08]);
        
        // 5. Auth Token field (4-byte length prefix + 64 null bytes)
        auth_header.put_u32(64);
        auth_header.put_bytes(0, 64);
        
        // 6. Connection ID field (4-byte length prefix + 16 connection ID bytes)
        let conn_id_bytes = conn_id.as_bytes();
        let conn_id_len = conn_id_bytes.len().min(16);
        auth_header.put_u32(16);
        auth_header.put_slice(&conn_id_bytes[..conn_id_len]);
        if conn_id_len < 16 {
            auth_header.put_bytes(0, 16 - conn_id_len);
        }
        
        // 7. Trailer (4 bytes)
        auth_header.put_u32(0x00000001);

        writer.write_all(&auth_header).await?;
        writer.flush().await?;

        Ok(Self { reader, writer })
    }
}

pub async fn read_packet<R: AsyncReadExt + Unpin>(reader: &mut R) -> Result<(u8, Vec<u8>)> {
    let mut header = [0u8; 9];
    
    // Use read instead of read_exact to detect connection closure more gracefully
    let mut total_read = 0;
    while total_read < 9 {
        let n = reader.read(&mut header[total_read..]).await?;
        if n == 0 {
            return Err(anyhow!("Connection closed while reading header"));
        }
        total_read += n;
    }
    
    let msg_type = header[0];
    let payload_len = u32::from_be_bytes([header[5], header[6], header[7], header[8]]) as usize;
    
    if payload_len == 0 {
        return Ok((msg_type, Vec::new()));
    }

    if payload_len > 1024 * 1024 {
         return Err(anyhow!("Payload too large: {}", payload_len));
    }

    let mut payload = vec![0u8; payload_len];
    let mut payload_read = 0;
    while payload_read < payload_len {
        let n = reader.read(&mut payload[payload_read..]).await?;
        if n == 0 {
            return Err(anyhow!("Connection closed while reading payload"));
        }
        payload_read += n;
    }
    
    Ok((msg_type, payload))
}

/// Sends the 33-byte latency stats packet (msgtype 0x12).
/// In the reference implementation, this is sent every 1 second.
pub async fn send_latency_stats<W: AsyncWriteExt + Unpin>(writer: &mut W) -> Result<()> {
    let mut pkt = BytesMut::with_capacity(33);
    // Header (9 bytes)
    pkt.put_u8(0x12);
    pkt.put_u32(1000); // Sequence (static 1000 in reference)
    pkt.put_u32(24);   // Payload length
    // Payload (24 bytes of zeros)
    pkt.put_bytes(0, 24);
    
    writer.write_all(&pkt).await?;
    writer.flush().await?;
    Ok(())
}

/// Sends the 9-byte keepalive packet (msgtype 0x0A).
/// In the reference implementation, this is sent every 10 seconds.
pub async fn send_keepalive<W: AsyncWriteExt + Unpin>(writer: &mut W, sequence: u32) -> Result<()> {
    let mut pkt = BytesMut::with_capacity(9);
    pkt.put_u8(0x0A);
    pkt.put_u32(sequence);
    pkt.put_u32(0); // Payload length 0
    
    writer.write_all(&pkt).await?;
    writer.flush().await?;
    Ok(())
}
