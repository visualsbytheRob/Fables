/**
 * F1049 — UI contribution sandboxing.
 *
 * Plugin-contributed UI is wrapped in an ErrorBoundary so a crashing plugin
 * cannot bring down the host app. The component intentionally does NOT use an
 * iframe (which would require a separate origin + postMessage ABI) because our
 * plugins are first-party trusted code loaded synchronously into the same
 * module graph. Instead we use an error boundary "portal" that:
 *
 *  1. Catches render errors and shows a safe fallback.
 *  2. Exposes a minimal prop surface — plugins receive only what the host
 *     explicitly passes, never the full React component tree.
 *  3. Prevents event bubbling escapes via stopPropagation on the container.
 *
 * If external (untrusted) plugins are ever supported, the sandbox would be
 * upgraded to an iframe with a postMessage bridge.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface PluginSandboxProps {
  pluginId: string;
  children: ReactNode;
}

interface PluginSandboxState {
  hasError: boolean;
  errorMessage: string;
}

export class PluginSandbox extends Component<PluginSandboxProps, PluginSandboxState> {
  override state: PluginSandboxState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: unknown): PluginSandboxState {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: msg };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface errors in dev; swallow in prod to keep the host healthy.
    if (import.meta.env.DEV) {
      console.error(`[PluginSandbox] Plugin "${this.props.pluginId}" threw:`, error, info);
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          className="plugin-sandbox-error"
          role="alert"
          aria-label={`Plugin ${this.props.pluginId} error`}
        >
          <span className="plugin-sandbox-error__icon" aria-hidden="true">
            ⚠
          </span>
          <span className="plugin-sandbox-error__text">
            Plugin &ldquo;{this.props.pluginId}&rdquo; failed to render.
          </span>
          {import.meta.env.DEV && (
            <pre className="plugin-sandbox-error__detail">{this.state.errorMessage}</pre>
          )}
          <button
            type="button"
            className="plugin-sandbox-error__reset"
            onClick={() => this.setState({ hasError: false, errorMessage: '' })}
          >
            Retry
          </button>
        </div>
      );
    }

    // Stop synthetic events from leaking out of the sandbox container.
    return (
      <div
        className="plugin-sandbox"
        data-plugin-id={this.props.pluginId}
        // Prevent plugin key events from triggering host shortcuts
        onKeyDown={(e) => e.stopPropagation()}
        onKeyUp={(e) => e.stopPropagation()}
      >
        {this.props.children}
      </div>
    );
  }
}
