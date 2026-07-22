"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ALONE SONG] Uncaught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            width: "100vw",
            background: "#08080b",
            gap: "20px",
            fontFamily: "'Rajdhani', 'Segoe UI', sans-serif",
            color: "#e7e7ee",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #ff5c6c 0%, #ff4fd8 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              boxShadow: "0 0 32px rgba(255,79,216,0.4)",
            }}
          >
            !
          </div>
          <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 700 }}>
            Something went wrong
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: "13px",
              color: "rgba(255,255,255,0.45)",
              maxWidth: "360px",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              marginTop: "8px",
              padding: "10px 28px",
              borderRadius: "8px",
              border: "1px solid rgba(62,230,224,0.4)",
              background: "rgba(62,230,224,0.1)",
              color: "#3ee6e0",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
              fontFamily: "inherit",
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
