import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Lock, Mail, Shield, AlertTriangle, CheckCircle, RefreshCw, KeyRound, Globe, Smartphone, User, LogOut } from 'lucide-react';
import { getDeviceFingerprint } from './utils/fingerprint';
import { API_URL, TENANT_ID } from './config';

function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  
  // Local CAPTCHA generation for testing (since google recaptcha requires key setup)
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [captchaError, setCaptchaError] = useState('');

  // Simulation controls (to help test Geolocation / Impossible Travel)
  const [mockIp, setMockIp] = useState('127.0.0.1');
  const [mockTimeOffset, setMockTimeOffset] = useState(0);

  // UI state
  const [currentPage, setCurrentPage] = useState('login'); // login, otp, locked, dashboard
  const [displayPage, setDisplayPage] = useState('login');
  const [fadeState, setFadeState] = useState('opacity-100');

  useEffect(() => {
    setFadeState('opacity-0 transition-opacity duration-120 ease-in-out');
    const timer = setTimeout(() => {
      setDisplayPage(currentPage);
      setFadeState('opacity-100 transition-opacity duration-200 ease-in-out');
    }, 120);
    return () => clearTimeout(timer);
  }, [currentPage]);

  const [sessionId, setSessionId] = useState('');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('warden_token') || '');
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  // Generate simple sum captcha
  const generateCaptcha = () => {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    setCaptchaAnswer((num1 + num2).toString());
    return `${num1} + ${num2}`;
  };
  const [captchaQuestion, setCaptchaQuestion] = useState(() => generateCaptcha());

  // Check current session on load
  useEffect(() => {
    if (token) {
      checkAuth(token);
    }
  }, [token]);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const interval = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setCurrentPage('login');
          setError('');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutRemaining]);

  const checkAuth = async (currentToken) => {
    try {
      const response = await axios.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      setUser(response.data.user);
      setCurrentPage('dashboard');
    } catch (err) {
      if (err.response && err.response.status === 403 && err.response.data.status === 'mfa_required') {
        setSessionId(err.response.data.sessionId);
        setCurrentPage('otp');
      } else {
        // Try transparent refresh token rotation
        try {
          const refreshResponse = await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true });
          const newAccessToken = refreshResponse.data.token;
          setToken(newAccessToken);
          localStorage.setItem('warden_token', newAccessToken);
          
          // Retry checkAuth with new token
          const retryResponse = await axios.get(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${newAccessToken}` },
          });
          setUser(retryResponse.data.user);
          setCurrentPage('dashboard');
        } catch (refreshErr) {
          localStorage.removeItem('warden_token');
          setToken('');
          setCurrentPage('login');
        }
      }
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    // Validate CAPTCHA if enabled
    if (showCaptcha) {
      if (captchaInput !== captchaAnswer) {
        setCaptchaError('Incorrect CAPTCHA answer. Try again.');
        setCaptchaQuestion(generateCaptcha());
        setCaptchaInput('');
        setLoading(false);
        triggerShake();
        return;
      }
      setCaptchaError('');
    }

    const now = new Date();
    const mockTime = new Date(now.getTime() + mockTimeOffset * 60 * 1000);
    const deviceFingerprint = {
      ...getDeviceFingerprint(),
      mockIp, // Attach user-selected mock IP to test geolocation rules
      mockTimestamp: mockTime.toISOString(),
    };

    try {
      const response = await axios.post(`${API_URL}/auth/login`, {
        email,
        password,
        captchaSolved: showCaptcha ? true : false,
        deviceFingerprint,
      });

      const { token: userToken, user: userData } = response.data;

      setSuccess('Login credentials accepted!');
      setToken(userToken);
      localStorage.setItem('warden_token', userToken);

      // Verify if MFA callback intercepts immediately
      setTimeout(() => {
        checkAuth(userToken);
        setLoading(false);
      }, 800);

    } catch (err) {
      setLoading(false);
      triggerShake();

      if (err.response) {
        const { status, data } = err.response;
        
        if (status === 423) {
          // Account locked
          setLockoutRemaining(data.lockoutRemaining || 900);
          setCurrentPage('locked');
        } else if (status === 400 && data.status === 'captcha_required') {
          // CAPTCHA required
          setShowCaptcha(true);
          setCaptchaQuestion(generateCaptcha());
          setError(data.message);
        } else {
          setError(data.message || 'Invalid email or password.');
          if (data.failures >= 5) {
            setShowCaptcha(true);
            setCaptchaQuestion(generateCaptcha());
          }
        }
      } else {
        setError('Cannot connect to Client Authentication service.');
      }
    }
  };

  const handleOtpVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await axios.post(`${API_URL}/auth/verify-otp`, {
        sessionId,
        otpCode: captchaInput,
      });
      
      setSuccess('MFA Verification Successful!');
      setCaptchaInput('');
      
      setTimeout(() => {
        checkAuth(token);
        setLoading(false);
      }, 800);
    } catch (err) {
      setLoading(false);
      setError(err.response?.data?.message || 'Invalid OTP code.');
      triggerShake();
    }
  };

  const handleLogout = async () => {
    const currentToken = token || localStorage.getItem('warden_token');
    try {
      if (currentToken) {
        await axios.post(`${API_URL}/auth/logout`, {}, {
          headers: { Authorization: `Bearer ${currentToken}` },
          withCredentials: true,
        });
      }
    } catch (err) {
      console.error('Logout error on server:', err);
    }
    localStorage.removeItem('warden_token');
    setToken('');
    setUser(null);
    setEmail('');
    setPassword('');
    setShowCaptcha(false);
    setCurrentPage('login');
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  // Render Page Content based on State
  return (
    <div 
      className="min-h-screen relative flex items-center justify-center overflow-hidden font-sans select-none"
      style={{
        background: 'radial-gradient(ellipse at 30% 50%, #0D5FA8 0%, #071F3C 100%)'
      }}
    >
      
      {/* Decorative SVG static constellation / shield pattern background */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-60" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="15%" cy="20%" r="200" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
        <circle cx="85%" cy="30%" r="450" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" />
        <circle cx="50%" cy="80%" r="300" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
        <circle cx="20%" cy="85%" r="150" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" />
        <circle cx="90%" cy="90%" r="250" stroke="rgba(255,255,255,0.03)" strokeWidth="1.5" />
        <circle cx="10%" cy="50%" r="600" stroke="rgba(255,255,255,0.02)" strokeWidth="2" />
        <circle cx="50%" cy="50%" r="400" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
      </svg>

      {/* Main Container Card */}
      <div 
        className={`w-[420px] bg-white rounded-[24px] shadow-[0_8px_40px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.12)] p-10 z-10 transition-all duration-300 ${
          shake ? 'animate-shake border border-status-critical' : ''
        }`}
      >
        
        {/* Warden Branding Header */}
        <div className="flex flex-col items-center mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-8 h-8 text-[#0A4D8C]" />
            <span className="font-display font-bold text-3xl text-[#0A4D8C] tracking-tight">Warden</span>
          </div>
          <div className="w-full h-px bg-[#E8F4FD] mb-4"></div>
          
          <span className="text-xs font-semibold uppercase tracking-wider text-brand-medium">
            {TENANT_ID === 'acme_corp' ? 'Acme Corporation' : 'Globex Corporation'}
          </span>
        </div>

        {/* Dynamic Transition Wrapper for Fade-through */}
        <div className={fadeState}>
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold font-display text-charcoal tracking-tight mt-1">
              {displayPage === 'login' && 'Welcome Back'}
              {displayPage === 'otp' && 'Verification Required'}
              {displayPage === 'locked' && 'Account Locked'}
              {displayPage === 'dashboard' && 'Access Active'}
            </h1>
            <p className="text-xs text-slate mt-1.5 leading-relaxed">
              {displayPage === 'login' && 'Sign in to your secure workspace.'}
              {displayPage === 'otp' && 'Enter the 6-digit OTP code sent to you.'}
              {displayPage === 'locked' && 'Security rules have locked your session.'}
              {displayPage === 'dashboard' && 'You have successfully authenticated.'}
            </p>
          </div>

          {/* Dynamic Alerts */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-status-critical flex items-center gap-2 animate-slideIn">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-status-success flex items-center gap-2 animate-slideIn">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* 1. Login Page Form */}
          {displayPage === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-charcoal uppercase tracking-wider mb-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-4 h-4 text-slate" />
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm text-charcoal placeholder-slate/50 focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12 transition-all"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[10px] font-bold text-charcoal uppercase tracking-wider">Password</label>
                  <a 
                    href="#" 
                    onClick={(e) => { e.preventDefault(); alert('Please contact your administrator to reset password.'); }} 
                    className="text-[10px] font-bold text-brand-medium hover:underline"
                  >
                    Forgot Password?
                  </a>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-slate" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm text-charcoal placeholder-slate/50 focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12 transition-all"
                  />
                </div>
              </div>

              {/* Remember Device and Mock IP settings */}
              <div className="flex flex-col gap-2.5 p-3.5 bg-[#F8FAFC] rounded-xl border border-brand-light">
                <label className="flex items-center text-xs text-charcoal cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="mr-2 rounded text-[#0A4D8C] focus:ring-[#0A4D8C] border-gray-300"
                  />
                  Remember this device
                </label>

                {/* Simulation Helper */}
                <div className="mt-1 border-t border-[#E8F4FD] pt-2.5">
                  <label className="block text-[10px] font-bold text-slate uppercase tracking-wider mb-1">Test Location Simulator (IP Override)</label>
                  <select
                    value={mockIp}
                    onChange={(e) => setMockIp(e.target.value)}
                    className="w-full text-xs bg-white border border-gray-200 rounded p-1.5 text-charcoal font-medium focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12"
                  >
                    <option value="127.0.0.1">Local Loopback (No Geo violation)</option>
                    <option value="82.165.195.10">London, UK (Standard Location)</option>
                    <option value="203.0.113.195">Tokyo, Japan (New Country Alert)</option>
                    <option value="175.45.176.1">Pyongyang, North Korea (High-Risk Country)</option>
                    <option value="109.252.0.1">Moscow, Russia (High-Risk Country)</option>
                  </select>
                  <span className="text-[9px] text-slate mt-1 block leading-normal">
                    Simulates geolocation triggers and travel distance relative to previous success.
                  </span>
                </div>

                {/* Time Simulation Helper */}
                <div className="mt-2 border-t border-[#E8F4FD] pt-2.5">
                  <label className="block text-[10px] font-bold text-slate uppercase tracking-wider mb-1">Test System Time Simulator (Time Override)</label>
                  <select
                    value={mockTimeOffset}
                    onChange={(e) => setMockTimeOffset(Number(e.target.value))}
                    className="w-full text-xs bg-white border border-gray-200 rounded p-1.5 text-charcoal font-medium focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12"
                  >
                    <option value="0">Current System Time (Local)</option>
                    <option value="-330">Simulate Midnight (12:00 AM IST)</option>
                    <option value="-150">Simulate 3 AM Night IST</option>
                    <option value="120">Add 2 Hours (+120 min)</option>
                    <option value="-240">Subtract 4 Hours (-240 min)</option>
                  </select>
                  <span className="text-[9px] text-slate mt-1 block leading-normal">
                    Simulates different hours to trigger anomalous timing detections.
                  </span>
                </div>
              </div>

              {/* Inline CAPTCHA Challenge */}
              {showCaptcha && (
                <div className="p-3.5 bg-red-50/50 border border-red-200 rounded-xl space-y-2.5 animate-slideIn">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-status-critical uppercase tracking-wider">Solve Math CAPTCHA</label>
                    <button type="button" onClick={() => setCaptchaQuestion(generateCaptcha())} className="text-slate hover:text-brand-dark transition-colors">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex gap-2.5 items-center">
                    <span className="text-sm font-bold text-charcoal bg-white border border-gray-200 px-3.5 py-2 rounded-lg font-mono">{captchaQuestion} =</span>
                    <input
                      type="number"
                      required
                      placeholder="Result"
                      value={captchaInput}
                      onChange={(e) => setCaptchaInput(e.target.value)}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center text-sm font-bold focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12 font-mono"
                    />
                  </div>
                  {captchaError && <p className="text-[10px] text-status-critical font-semibold">{captchaError}</p>}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#0A4D8C] hover:bg-[#0D6EB8] text-white rounded-xl font-semibold text-sm transition-all duration-150 transform hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.99] flex items-center justify-center gap-2 shadow-sm"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Sign In'}
              </button>
            </form>
          )}

          {/* 2. OTP Verification Screen */}
          {displayPage === 'otp' && (
            <form onSubmit={handleOtpVerify} className="space-y-4">
              <div className="flex flex-col items-center">
                <KeyRound className="w-10 h-10 text-brand-medium animate-pulse mb-2" />
                <p className="text-xs text-slate text-center leading-relaxed">
                  Check terminal console logs for the printed code. It was pushed via Central Platform callback.
                </p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-charcoal uppercase tracking-wider mb-1 text-center">Enter Verification Code</label>
                <input
                  type="text"
                  required
                  maxLength="6"
                  placeholder="000000"
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-lg tracking-widest text-center text-[#0A4D8C] font-bold placeholder-gray-300 focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12 font-mono transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#0A4D8C] hover:bg-[#0D6EB8] text-white rounded-xl font-semibold text-sm transition-all duration-150 transform hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.99] flex items-center justify-center gap-2 shadow-sm"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Verify Code'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2.5 border border-gray-300 text-charcoal rounded-xl font-semibold text-sm hover:bg-[#F8FAFC] transition-colors"
              >
                Cancel
              </button>
            </form>
          )}

          {/* 3. Account Locked Screen */}
          {displayPage === 'locked' && (
            <div className="space-y-6 text-center">
              <div className="w-16 h-16 bg-red-50 text-status-critical rounded-full flex items-center justify-center mx-auto border border-red-200 animate-pulse">
                <Lock className="w-8 h-8" />
              </div>
              {lockoutRemaining === -1 || lockoutRemaining === null ? (
                <>
                  <div className="p-4 bg-red-50/50 border border-red-200 rounded-xl">
                    <h2 className="text-sm font-bold text-status-critical mb-1 uppercase tracking-wider">Administrative Lockout</h2>
                    <p className="text-xs text-slate leading-relaxed">
                      Your account has been locked by an administrator. Please contact security support for bypass credentials.
                    </p>
                  </div>
                  <div className="text-2xl font-bold font-display text-status-critical tracking-tight">
                    LOCKED INDEFINITELY
                  </div>
                  <p className="text-[10px] text-slate font-medium">Contact security for admin override keys.</p>
                </>
              ) : (
                <>
                  <div className="p-4 bg-red-50/50 border border-red-200 rounded-xl">
                    <h2 className="text-sm font-bold text-status-critical mb-1 uppercase tracking-wider">Temporary Lockout</h2>
                    <p className="text-xs text-slate leading-relaxed">
                      Your account is locked for safety due to excessive failed attempts or suspicious parameters detected by our rule engine.
                    </p>
                  </div>
                  <div className="text-4xl font-bold font-display text-charcoal font-tabular tracking-tight">
                    {formatTime(lockoutRemaining)}
                  </div>
                  <p className="text-[10px] text-slate font-medium">Lock expires in the window above.</p>
                </>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-3 bg-[#0A4D8C] hover:bg-[#0D6EB8] text-white rounded-xl font-semibold text-sm transition-all"
              >
                Back to Sign In
              </button>
            </div>
          )}

          {/* 4. Active Dashboard View */}
          {displayPage === 'dashboard' && user && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-status-success font-bold text-sm">
                  <CheckCircle className="w-5 h-5" />
                  <span>Session Active</span>
                </div>
                <p className="text-xs text-slate leading-relaxed">
                  Your login credentials were validated and approved by the Warden Security Rule Engine.
                </p>
              </div>

              <div className="border border-brand-light rounded-xl p-3.5 space-y-2.5 text-xs font-medium">
                <div className="flex justify-between border-b border-[#E8F4FD] pb-2.5">
                  <span className="text-slate">User Email:</span>
                  <span className="font-semibold text-charcoal">{user.email}</span>
                </div>
                <div className="flex justify-between border-b border-[#E8F4FD] pb-2.5">
                  <span className="text-slate">Unique ID:</span>
                  <span className="font-semibold text-charcoal">#{user.id}</span>
                </div>
                <div className="flex justify-between pb-1">
                  <span className="text-slate">Client DB:</span>
                  <span className="font-bold text-[#0A4D8C] uppercase tracking-wider">{TENANT_ID}</span>
                </div>
              </div>

              {/* Test coordinates overrides */}
              <div className="p-3.5 bg-[#F8FAFC] rounded-xl border border-brand-light space-y-2">
                <h3 className="text-xs font-bold text-charcoal flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#0A4D8C]" />
                  Telemetry Verification Hub
                </h3>
                <p className="text-[10px] text-slate leading-normal">
                  To test the <strong>Impossible Travel Rule</strong>: Log out, change the IP dropdown to a foreign country, and log in again. Central computes speed between consecutive logins!
                </p>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-3 bg-status-critical hover:bg-red-700 text-white rounded-xl font-semibold text-sm transition-all duration-150 transform hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.99] flex items-center justify-center gap-2 shadow-sm"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>

        <div className="mt-8 text-center border-t border-[#E8F4FD] pt-4">
          <p className="text-[10px] text-[#6B7FA3] flex items-center justify-center gap-1 font-semibold">
            <Shield className="w-3.5 h-3.5 text-[#0A4D8C]" />
            <span>Protected by Warden Security Monitoring Platform.</span>
          </p>
        </div>

      </div>
    </div>
  );
}

export default App;
