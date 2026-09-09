import { Component, type ReactNode } from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 text-white bg-slate-950">
          <p className="text-red-400 font-bold text-lg">Errore imprevisto</p>
          <p className="text-slate-400 text-sm max-w-sm text-center">{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition"
          >
            Ricarica applicazione
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
