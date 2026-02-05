FROM rust:1.76-bookworm AS build

WORKDIR /app
COPY . .

RUN cargo build --release --manifest-path server/Cargo.toml

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PORT=3020
ENV BLINK_DATA_DIR=/data

WORKDIR /app
COPY --from=build /app/server/target/release/blink-monitor-server /usr/local/bin/blink-monitor-server

VOLUME ["/data"]

EXPOSE 3020
CMD ["blink-monitor-server"]
