import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import * as Sentry from "@sentry/react";
import "./theme/tokens.css";
import "./adventure/adventure.css";
import "./landing/landing.css";
import { AdventureRoot } from "./adventure/AdventureApp.js";
import { initWebSentry } from "./observability/sentry.js";

initWebSentry();

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

function MissingKey() {
  return (
    <div className="adv">
      <div className="adv-start">
        <h1 className="adv-display">DungeonsDaily</h1>
        <p className="adv-lede">
          Sign-in is not configured yet. Run{" "}
          <code>clerk env pull --file apps/web/.env.local</code> from the
          project root, then restart the web server.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publishableKey ? (
      <ClerkProvider
        publishableKey={publishableKey}
        appearance={{
          variables: {
            colorPrimary: "#f3c530",
            colorBackground: "#0a1710",
            colorForeground: "#f2f7ef",
            colorMutedForeground: "#b7cdb9",
            colorInput: "#06110a",
            colorInputForeground: "#f2f7ef",
            colorPrimaryForeground: "#0e1b10",
            colorBorder: "#3a5c46",
            colorRing: "#f3c530",
            colorModalBackdrop: "rgba(3, 12, 7, 0.75)",
            borderRadius: "0.875rem",
          },
          elements: {
            // Google / social buttons render with dark text on our dark
            // modal — force white so the label stays readable.
            socialConnectionButton: {
              color: "#ffffff",
            },
            socialConnectionsProviderButton: {
              color: "#ffffff",
            },
            socialConnectionsProviderButton__google: {
              color: "#ffffff",
            },
          },
        }}
      >
        <Sentry.ErrorBoundary
          fallback={
            <div className="adv">
              <div className="adv-start">
                <h1 className="adv-display">The dungeon trembles</h1>
                <p className="adv-lede">
                  Something broke on this device. Reload to try again; your
                  chronicle is safe in the vault.
                </p>
                <button
                  className="adv-btn adv-btn-speak"
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  Reload the adventure
                </button>
              </div>
            </div>
          }
        >
          <AdventureRoot />
        </Sentry.ErrorBoundary>
      </ClerkProvider>
    ) : (
      <MissingKey />
    )}
  </React.StrictMode>,
);
