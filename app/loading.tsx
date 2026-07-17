/**
 * app/loading.tsx
 * Next.js App Router automatic loading UI.
 * This is rendered instantly (server-side) while the heavy client bundle
 * for page.tsx is being downloaded and hydrated.
 * It eliminates the black-screen flash the user sees on first load.
 */
export default function Loading() {
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
        gap: "24px",
        fontFamily: "'Rajdhani', 'Segoe UI', sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Logo + wordmark */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
        }}
      >
        {/* Animated logo icon */}
        <div
          style={{
            position: "relative",
            width: "64px",
            height: "64px",
          }}
        >
          {/* Outer pulsing ring */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "2px solid rgba(62,230,224,0.3)",
              animation: "ring-pulse 2s ease-in-out infinite",
            }}
          />
          {/* Inner solid circle */}
          <div
            style={{
              position: "absolute",
              inset: "8px",
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 40% 40%, #3ee6e0 0%, #a45bff 60%, #ff4fd8 100%)",
              boxShadow: "0 0 32px rgba(62,230,224,0.5), 0 0 64px rgba(164,91,255,0.3)",
              animation: "icon-breathe 2s ease-in-out infinite",
            }}
          />
          {/* Music note icon SVG */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#08080b"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="18" r="4" />
              <path d="M12 18V2l7 4" />
            </svg>
          </div>
        </div>

        {/* ALONE SONG text */}
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "28px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              color: "#ffffff",
              lineHeight: 1,
            }}
          >
            ALONE
            <span
              style={{
                background:
                  "linear-gradient(90deg, #3ee6e0, #ff4fd8, #a45bff)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {" "}
              SONG
            </span>
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: "10px",
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.3)",
            }}
          >
            Web DAW · Loading
          </p>
        </div>
      </div>

      {/* Progress / waveform bar */}
      <div
        style={{
          width: "220px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "10px",
        }}
      >
        {/* Animated waveform bars */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            height: "32px",
          }}
        >
          {[0, 60, 120, 180, 240, 300, 360].map((delay) => (
            <div
              key={delay}
              style={{
                width: "4px",
                borderRadius: "999px",
                background: "linear-gradient(to top, #3ee6e0, #a45bff)",
                animation: `wave-bar 1.2s ease-in-out ${delay}ms infinite`,
              }}
            />
          ))}
        </div>

        {/* Thin progress line */}
        <div
          style={{
            width: "100%",
            height: "2px",
            background: "rgba(255,255,255,0.08)",
            borderRadius: "999px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: "999px",
              background: "linear-gradient(90deg, #3ee6e0, #a45bff)",
              animation: "progress-slide 1.8s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      {/* Keyframe styles via a style tag */}
      <style>{`
        @keyframes ring-pulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.15); opacity: 0.9; }
        }
        @keyframes icon-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @keyframes wave-bar {
          0%, 100% { height: 6px; }
          50% { height: 28px; }
        }
        @keyframes progress-slide {
          0% { width: 0%; margin-left: 0%; }
          50% { width: 60%; margin-left: 20%; }
          100% { width: 0%; margin-left: 100%; }
        }
      `}</style>
    </div>
  );
}
