import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

const urlParams = new URLSearchParams(window.location.search)
if (urlParams.get('debug') === 'art') {
  import('./components/ArtDebugger.tsx').then(({ default: ArtDebugger }) => {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <ArtDebugger />
      </React.StrictMode>
    )
  })
} else {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
