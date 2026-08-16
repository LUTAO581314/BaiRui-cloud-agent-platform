import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { App } from './App';
import './styles.css';

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[console-mvp] 未捕获的渲染错误', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const error = this.state.error;
    return <main className="fatal-error-screen"><section className="fatal-error-card"><span className="fatal-error-icon"><TriangleAlert /></span><p>前端页面发生未处理错误</p><h1>页面暂时无法显示</h1><span>请先刷新页面；开发阶段可以展开下方错误详情定位问题。</span><div className="fatal-error-actions"><button className="button primary" type="button" onClick={() => window.location.reload()}><RefreshCw />刷新页面</button></div>{import.meta.env.DEV ? <details className="error-details" open><summary>开发调试详情</summary><pre>{error.stack ?? error.message}</pre></details> : null}</section></main>;
  }
}

const root = document.querySelector('#root');

if (!root) {
  throw new Error('Root container is missing');
}

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
