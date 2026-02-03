import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

type ErrorBoundaryState = { hasError: boolean; error: string };

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: "" };

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return { hasError: true, error: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(error: unknown) {
    console.error("Render error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
          <div className="max-w-xl text-center">
            <h1 className="text-xl font-bold mb-3">App crashed while rendering</h1>
            <p className="text-sm text-slate-400 mb-4">{this.state.error}</p>
            <p className="text-xs text-slate-500">
              If you see this, grab the error text and send it to me so I can fix the root cause.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener("error", (event) => {
  console.error("Window error:", event.error || event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
