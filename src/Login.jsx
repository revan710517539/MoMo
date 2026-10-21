import React, { useId, useState } from 'react';
import { ArrowRight, Check, CircleNotch, Eye, EyeSlash, LockKey, PawPrint, SignOut, Sparkle, User, WarningCircle, X } from '@phosphor-icons/react';
import './login.css';

export function validateAccountInput({ username = '', password = '' }) {
  if (!username.trim()) return '请输入登录邮箱。';
  if (username.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username.trim())) return '请输入正确的邮箱地址。';
  if (!password.length || password.length > 128) return '请输入密码，最多 128 个字符。';
  return '';
}

export function LoginScreen({ status = {}, onSubmit, hero, children, onGuest }) {
  const id = useId();
  const [form, setForm] = useState({ username:'', password:'' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [visible,setVisible] = useState(false);
  const change = (key,value) => {setForm(v=>({...v,[key]:value}));if(error)setError('');};
  async function submit(event) {
    event.preventDefault();if(busy)return;
    const invalid=validateAccountInput(form);
    if(invalid){setError(invalid);return;}
    setBusy(true);setError('');
    try {
      if(typeof onSubmit!=='function')throw new Error('账户服务暂时不可用，请稍后重试。');
      await onSubmit({username:form.username.trim(),password:form.password});
    }catch(e){setError((e?.message || '暂时无法进入工作台，请重试。')+(e?.retryAfterMs?` 约 ${Math.ceil(e.retryAfterMs/1000)} 秒后可重试。`:''));}finally{setBusy(false);}
  }
  return <div className="momo-auth"><div className="auth-titlebar" aria-hidden="true"/><section className="auth-welcome"><div className="auth-brand"><span><Sparkle size={23} weight="fill"/></span><strong>Momo<small>小作坊</small></strong></div><div className="auth-welcome-content"><span className="auth-eyebrow"><span/>给灵感一个小小的开始</span><h1>把好点子，<br/>做成自己的小工具。</h1><p>说出你想怎么工作，<br/>Momo 陪你一起做出来。</p><div className="auth-pet-stage"><div className="auth-pet-orbit"/><div className="auth-pet-halo"/><div className="auth-pet-hero">{hero || children || <img src="./assets/momo.png" alt="戴绿色围巾的小兔 Momo"/>}</div><div className="auth-pet-note"><Sparkle size={16} weight="fill"/>你的新搭档，已经就位</div></div><div className="auth-benefits"><span><Check size={14}/>自然语言制作</span><span><Check size={14}/>在本机运行</span><span><Check size={14}/>随时再次使用</span></div></div><p className="auth-left-footer">一点灵感，一点陪伴，一点新的可能。</p></section><main className="auth-form-side"><div className="auth-form-container"><span className="auth-form-icon"><LockKey size={23}/></span><h2>欢迎回来</h2><p className="auth-form-description">使用统一账号，进入你的工作台。</p><form className="auth-form" onSubmit={submit} noValidate>
      <label htmlFor={`${id}-username`}>登录邮箱<input id={`${id}-username`} name="username" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.username} onChange={e=>change('username',e.target.value)} maxLength={254} placeholder="输入你的邮箱" disabled={busy}/></label>
      <label htmlFor={`${id}-password`}>密码<span className="auth-password"><input id={`${id}-password`} name="password" type={visible?'text':'password'} autoComplete="current-password" value={form.password} onChange={e=>change('password',e.target.value)} maxLength={128} placeholder="输入你的密码" disabled={busy}/><button type="button" aria-label={visible?'隐藏密码':'显示密码'} aria-pressed={visible} onClick={()=>setVisible(v=>!v)} disabled={busy}>{visible?<EyeSlash size={19}/>:<Eye size={19}/>}</button></span></label>
      {error&&<div className="auth-error" id={`${id}-error`} role="alert"><WarningCircle size={18}/><span>{error}</span></div>}
      <button className="auth-submit" type="submit" disabled={busy}>{busy?<><CircleNotch className="auth-spin" size={19}/>正在登录…</>:<>进入我的工作台<ArrowRight size={18}/></>}</button>
    </form><div className="auth-local-note"><LockKey size={15}/><p>请使用约定的统一账号登录，工作工具在你的电脑上运行。</p></div>{onGuest&&<button className="auth-preview" type="button" disabled={busy} onClick={onGuest}>先看看网页预览<ArrowRight size={14}/></button>}</div><span className="auth-form-footer">为你的小想法，留一片自己的空间。</span></main></div>;
}

export function AuthGate({ status = {}, children, ...props }) {
  return status.authenticated && status.user ? children : <LoginScreen status={status} {...props}/>;
}

export function AccountPanel({ user = {}, onLogout, onClose }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function logout(){if(busy)return;setBusy(true);setError('');try{await onLogout?.();}catch(e){setError(e?.message||'退出未完成，请重试。');}finally{setBusy(false);}}
  return <section className="auth-account-panel"><header><h2>我的账户</h2>{onClose&&<button type="button" aria-label="关闭账户信息" onClick={onClose}><X size={20}/></button>}</header><div className="auth-account-person"><span className="auth-account-avatar"><User size={28}/></span><div><strong>{user.displayName || user.username || '我的工作台'}</strong><small>{user.username}</small></div></div><p className="auth-account-note">统一账号<br/>退出后，工具会保留在这台电脑上。</p>{error&&<div className="auth-error" role="alert"><WarningCircle size={18}/><span>{error}</span></div>}<button type="button" className="auth-logout" onClick={logout} disabled={busy}>{busy?<CircleNotch className="auth-spin" size={17}/>:<SignOut size={17}/>}退出登录</button></section>;
}
