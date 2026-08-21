import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Uncaught error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex items-center justify-center bg-bg px-4">
          <div className="card w-full max-w-sm p-10 text-center">
            <h1 className="text-base font-semibold text-ink mb-2">
              Something went wrong
            </h1>
            <p className="text-xs text-muted leading-relaxed mb-6">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary mx-auto"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
