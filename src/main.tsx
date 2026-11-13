import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/noto-serif-sc/400.css';
import '@fontsource/noto-serif-sc/500.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './app/styles.css';
import { bootstrap } from './app/bootstrap';
import { ServicesContext } from './app/context';
import { App } from './app/App';

class ErrorBoundary extends React.Component<React.PropsWithChildren,{error?:string}>{
  state:{error?:string}={};static getDerivedStateFromError(error:Error){return{error:error.message};}
  render(){return this.state.error?<main className="fatal"><h1>编辑器需要重新载入</h1><p>{this.state.error}</p><p>已保存的项目会从本机恢复。</p><button onClick={()=>location.reload()}>重新载入</button></main>:this.props.children;}
}
const root=createRoot(document.getElementById('root')!);
root.render(<main className="boot"><span className="brand-mark">✳</span><h1>Travel Studio</h1><p>正在打开你的旅行工作台…</p></main>);
bootstrap().then(services=>root.render(<ErrorBoundary><ServicesContext.Provider value={services}><App/></ServicesContext.Provider></ErrorBoundary>)).catch(error=>root.render(<main className="fatal"><h1>本地存储暂时不可用</h1><p>{error.message}</p><p>请在正常浏览模式下打开，允许此页面保存本地资料，然后重试。</p><button onClick={()=>location.reload()}>重试</button></main>));
