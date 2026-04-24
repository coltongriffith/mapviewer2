import React, { useRef, useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import AuthModal from './AuthModal';

export default function UserMenu({ onOpenTemplates }) {
  const { user, signOut } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) {
    return (
      <>
        <button className="btn user-menu-signin-btn" onClick={() => setShowAuth(true)}>
          Sign in
        </button>
        {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      </>
    );
  }

  const displayEmail = user.email
    ? user.email.length > 22 ? user.email.slice(0, 20) + '…' : user.email
    : 'Account';

  return (
    <div className="user-menu-wrap" ref={menuRef}>
      <button
        className="btn user-menu-btn"
        onClick={() => setOpen((v) => !v)}
        title={user.email}
      >
        {displayEmail}
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-email">{user.email}</div>
          <button
            className="user-menu-item"
            onClick={() => { setOpen(false); onOpenTemplates?.(); }}
          >
            My Templates
          </button>
          <button
            className="user-menu-item"
            onClick={() => { setOpen(false); signOut(); }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
