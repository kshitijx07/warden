import React, { useState, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { io } from 'socket.io-client';
import { Toaster, toast } from 'react-hot-toast';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Shield,
  LayoutDashboard,
  Building2,
  AlertOctagon,
  History,
  Users,
  LogOut,
  Bell,
  ChevronLeft,
  ChevronRight,
  Menu,
  Lock,
  Unlock,
  Check,
  Search,
  Plus,
  Copy,
  RefreshCw,
  Clock,
  UserCheck,
  AlertTriangle,
  Play,
  Volume2,
  VolumeX,
  Sliders
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';
import { useAuthStore } from './store/useAuthStore';
import { API_URL, SOCKET_URL } from './config';

const queryClient = new QueryClient();

// Synthesise audio warning chime (pleasant and robust)
function playWarningChime(severity) {
  try {
    const { isMuted } = useAuthStore.getState();
    if (isMuted) return;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Play sound 1
    const playTone = (freq, type, duration, delay) => {
      setTimeout(() => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      }, delay);
    };

    if (severity === 'critical') {
      // Double alarm sound
      playTone(880, 'sawtooth', 0.2, 0);
      playTone(880, 'sawtooth', 0.2, 180);
    } else if (severity === 'high') {
      // Single alarm alert
      playTone(587.33, 'triangle', 0.3, 0); // D5
    } else {
      // Light soft chime
      playTone(523.25, 'sine', 0.4, 0); // C5
    }
  } catch (err) {
    console.error('Failed to play alarm sound:', err);
  }
}

// Dynamic Favicon Manager to swap badge on new threat exceptions
function updateFavicon(hasCritical) {
  try {
    let favicon = document.querySelector("link[rel*='icon']");
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'shortcut icon';
      document.getElementsByTagName('head')[0].appendChild(favicon);
    }
    favicon.type = 'image/svg+xml';
    
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <path d="M50 10 L85 25 L85 55 C85 75 50 90 50 90 C50 90 15 75 15 55 L15 25 Z" fill="%230A4D8C" />
        ${hasCritical ? '%3Ccircle cx="75" cy="25" r="18" fill="%23D93025" stroke="%23FFFFFF" stroke-width="4"/%3E' : ''}
      </svg>
    `;
    
    favicon.href = 'data:image/svg+xml;utf8,' + svgContent.trim();
  } catch (err) {
    console.error('Failed to update favicon:', err);
  }
}

// Counter rolling component simulating flip mechanical boards
function StatNumber({ value }) {
  const [displayVal, setDisplayVal] = useState(value);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (value !== displayVal) {
      setAnimate(true);
      const timer = setTimeout(() => {
        setDisplayVal(value);
        setAnimate(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [value, displayVal]);

  return (
    <span className={`inline-block font-display font-bold text-3xl text-charcoal font-tabular ${animate ? 'counter-roll-up' : ''}`}>
      {displayVal}
    </span>
  );
}

// Gestural line-based sparkline
function Sparkline({ data, color }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const width = 80;
  const height = 28;
  const padding = 2;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min === 0 ? 1 : max - min;
  
  const points = data.map((val, index) => {
    const x = (index / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - ((val - min) / range) * (height - padding * 2) - padding;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

// 5 shimmer skeleton rows for Alert Feed
function AlertFeedSkeleton() {
  return (
    <div className="space-y-4 w-full">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="p-4 bg-white border border-brand-light rounded-xl flex items-center justify-between gap-4 shimmer-bg relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#E4EBF5]"></div>
          <div className="flex items-center gap-3">
            <div className="h-6 w-16 bg-[#E4EBF5] rounded-full"></div>
            <div className="space-y-2">
              <div className="h-4 w-32 bg-[#E4EBF5] rounded"></div>
              <div className="h-3 w-48 bg-[#E4EBF5] rounded"></div>
            </div>
          </div>
          <div className="h-3 w-16 bg-[#E4EBF5] rounded"></div>
        </div>
      ))}
    </div>
  );
}

// Shimmer skeleton for logs and lists
function TableSkeleton() {
  return (
    <div className="space-y-4 w-full">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center justify-between p-4 border border-brand-light rounded-xl shimmer-bg bg-white opacity-70">
          <div className="h-4 w-24 bg-[#E4EBF5] rounded"></div>
          <div className="h-4 w-40 bg-[#E4EBF5] rounded"></div>
          <div className="h-4 w-12 bg-[#E4EBF5] rounded"></div>
          <div className="h-4 w-20 bg-[#E4EBF5] rounded"></div>
        </div>
      ))}
    </div>
  );
}

// Breathing Checkmark Shield Empty State Illustration
function EmptyStateAlerts() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
      <div className="empty-state-shield text-[#E8F4FD] flex items-center justify-center">
        <svg className="w-[80px] h-[80px]" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M50 10 L85 25 L85 55 C85 75 50 90 50 90 C50 90 15 75 15 55 L15 25 Z" stroke="#E8F4FD" strokeWidth="3" fill="none" />
          <path d="M35 50 L45 60 L65 40" stroke="#2E9E6B" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="font-display font-semibold text-lg text-charcoal tracking-tight mt-2">No threats detected</h3>
      <p className="text-sm text-slate max-w-sm">Your monitored employees are showing normal activity.</p>
    </div>
  );
}

// Circular Risk Score Gauge SVG Arc
function RiskCircularGauge({ score }) {
  const [displayScore, setDisplayScore] = useState(0);
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  useEffect(() => {
    let start = 0;
    const end = score;
    if (start === end) {
      setDisplayScore(end);
      return;
    }
    const totalDuration = 800;
    const stepTime = 16;
    const totalSteps = totalDuration / stepTime;
    const increment = (end - start) / totalSteps;
    
    let currentStep = 0;
    const timer = setInterval(() => {
      currentStep++;
      setDisplayScore(prev => {
        const next = Math.round(start + increment * currentStep);
        if (next >= end || currentStep >= totalSteps) {
          clearInterval(timer);
          return end;
        }
        return next;
      });
    }, stepTime);

    return () => clearInterval(timer);
  }, [score]);

  const getColor = (s) => {
    if (s <= 30) return '#2E9E6B';
    if (s <= 60) return '#1A7FBF';
    if (s <= 80) return '#F5A623';
    return '#D93025';
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-2">
      <div className="relative w-[120px] h-[120px] flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={radius} stroke="#E8F4FD" strokeWidth="8" fill="none" />
          <circle 
            cx="60" 
            cy="60" 
            r={radius} 
            stroke={getColor(score)} 
            strokeWidth="8" 
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            fill="none"
            style={{
              transition: 'stroke-dashoffset 800ms ease-out, stroke 800ms ease-out'
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display font-bold text-3xl font-tabular text-charcoal">{displayScore}</span>
          <span className="text-[9px] uppercase tracking-wider text-slate font-bold">Risk Index</span>
        </div>
      </div>
    </div>
  );
}

// Proportional Threat Vector Contribution stacked bar
function RiskScoreBreakdown({ breakdown }) {
  const parsed = typeof breakdown === 'string' ? JSON.parse(breakdown) : (breakdown || {});
  const categories = {
    failed_logins: { label: 'Failed Logins', color: '#D93025' },
    device_fingerprint: { label: 'Device History', color: '#1A7FBF' },
    geolocation: { label: 'Geolocation', color: '#F5A623' },
    time_of_day: { label: 'Time Of Day', color: '#8B5CF6' },
    concurrent_session: { label: 'Concurrent Session', color: '#14B8A6' },
  };

  const segments = Object.entries(parsed)
    .map(([key, val]) => {
      const score = val.score || 0;
      const meta = categories[key] || { label: key, color: '#6B7FA3' };
      return { key, score, ...meta };
    })
    .filter(s => s.score > 0);

  const total = segments.reduce((sum, s) => sum + s.score, 0);

  if (total === 0) {
    return (
      <div className="text-center text-[10px] text-slate font-semibold pt-2.5">
        Roster mismatch default score (+100)
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full mt-4 border-t border-[#E8F4FD] pt-4">
      <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate text-center">Threat Vector Contribution</h5>
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-[#F0F4F8] border border-gray-100 shadow-inner">
        {segments.map((seg) => {
          const percentage = (seg.score / total) * 100;
          return (
            <div 
              key={seg.key} 
              className="relative group cursor-pointer h-full transition-all duration-300 hover:brightness-95"
              style={{ width: `${percentage}%`, backgroundColor: seg.color }}
            >
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-40 hidden group-hover:block bg-slate-900 text-white rounded-lg shadow-xl p-2.5 z-50 text-[10px] text-center border border-slate-700 pointer-events-none">
                <span className="font-bold block uppercase tracking-wider text-[9px]" style={{ color: seg.color }}>{seg.label}</span>
                <span className="font-semibold block mt-0.5 text-white font-mono">+{seg.score} Risk Points</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[9px] font-bold uppercase text-slate mt-2.5">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }}></span>
            <span>{seg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// World Map Login Heatmap component utilizing Leaflet.js natively
function WorldMap({ token }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ['loginEventsForMap'],
    queryFn: async () => {
      const res = await axios.get(`${API_URL}/admin/login-events`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (!window.L || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = window.L.map(mapContainerRef.current).setView([20, 0], 2);
      
      window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(mapInstanceRef.current);
    }

    const map = mapInstanceRef.current;

    map.eachLayer((layer) => {
      if (layer instanceof window.L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

    if (data?.loginEvents) {
      data.loginEvents.forEach((evt) => {
        const lat = parseFloat(evt.latitude);
        const lng = parseFloat(evt.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        const isHighRiskCountry = ['RU', 'CN', 'KP', 'Russia', 'China', 'North Korea'].includes(evt.country);
        const isHighRiskScore = evt.risk_score >= 80;
        const color = (isHighRiskCountry || isHighRiskScore) ? '#D93025' : '#1A7FBF';

        const tooltipContent = `
          <div style="font-family: 'DM Sans', sans-serif; font-size: 11px; color: #1e293b; padding: 2px;">
            <div style="font-weight: bold; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 4px; color: #0f172a; text-transform: uppercase; font-size: 9px; tracking: 0.05em;">
              Login Telemetry Event
            </div>
            <p style="margin: 2px 0;"><strong>Employee:</strong> ${evt.email}</p>
            <p style="margin: 2px 0;"><strong>Location:</strong> ${evt.city || 'Unknown'}, ${evt.country || 'Unknown'}</p>
            <p style="margin: 2px 0;"><strong>IP Address:</strong> ${evt.ip_address}</p>
            <p style="margin: 2px 0;"><strong>Risk Score:</strong> <span style="color: ${color}; font-weight: bold;">${evt.risk_score || 0}/100</span></p>
            <p style="margin: 2px 0; font-size: 9px; color: #64748b;"><strong>Time:</strong> ${new Date(evt.timestamp).toLocaleString()}</p>
          </div>
        `;

        const marker = window.L.circleMarker([lat, lng], {
          radius: (isHighRiskCountry || isHighRiskScore) ? 8 : 6,
          fillColor: color,
          color: '#FFF',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.85
        });

        marker.bindPopup(tooltipContent).addTo(map);
      });
    }
  }, [data]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="bg-white rounded-xl shadow p-6 border border-brand-light">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-xs font-semibold uppercase text-slate tracking-wider">Global Logins Live Heatmap</h3>
          <p className="text-[10px] text-slate mt-0.5">Geospatial telemetry mapping. Red indicators indicate high-risk events (Russia, China, North Korea, or score &ge; 80).</p>
        </div>
      </div>
      {isLoading ? (
        <div className="h-[350px] w-full rounded-lg border border-brand-light bg-slate-50 flex items-center justify-center text-xs text-slate">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading heatmap data...
        </div>
      ) : (
        <div 
          ref={mapContainerRef} 
          style={{ height: '350px' }} 
          className="w-full rounded-lg overflow-hidden border border-brand-light z-10"
        />
      )}
    </div>
  );
}

function LockCountdown({ lockUntil }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!lockUntil) {
      setTimeLeft('Indefinite');
      return;
    }

    const updateTimer = () => {
      const diff = new Date(lockUntil) - new Date();
      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}m ${seconds.toString().padStart(2, '0')}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lockUntil]);

  if (!lockUntil) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-[#D93025] border border-red-100">
        <Lock className="w-3 h-3" /> Permanent Administrative Lock
      </span>
    );
  }

  if (timeLeft === 'Expired') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-status-success border border-green-100 animate-pulse">
        <Unlock className="w-3 h-3" /> Auto-Lock Expired
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-status-warning border border-amber-100">
      <Clock className="w-3 h-3" /> Locked ({timeLeft})
    </span>
  );
}

function LockedEmployeesView({ token, role, companies }) {
  const queryClient = useQueryClient();
  const [companyFilter, setCompanyFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch locked employees query
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['lockedEmployees', companyFilter],
    queryFn: async () => {
      const url = companyFilter 
        ? `${API_URL}/admin/employees/locked?companyId=${companyFilter}`
        : `${API_URL}/admin/employees/locked`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    refetchInterval: 5000, // Auto refresh every 5 seconds to keep countdown and sync live!
  });

  // Mutation: Unlock Employee
  const unlockMutation = useMutation({
    mutationFn: async ({ id, companyId }) => {
      await axios.post(`${API_URL}/admin/employees/${id}/lock-action`, { lock: false, companyId }, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      toast.success('Account successfully unlocked');
      queryClient.invalidateQueries({ queryKey: ['lockedEmployees'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to unlock employee');
    }
  });

  const filtered = data?.lockedEmployees?.filter(emp => {
    return searchQuery === '' || emp.email.toLowerCase().includes(searchQuery.toLowerCase()) || emp.external_employee_id.toString().includes(searchQuery);
  }) || [];

  return (
    <div className="space-y-6">
      <div className="card-warden p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-base font-bold font-display text-charcoal">Locked Accounts Manager</h2>
            <p className="text-xs text-slate">Monitor automatically locked threat-associated sessions and issue override bypass keys.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {role === 'superadmin' && (
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-xl text-xs text-charcoal focus:outline-none focus:border-[#0A4D8C] focus:bg-brand-light transition-all"
              >
                <option value="">All Companies</option>
                {companies?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate" />
              <input
                type="text"
                placeholder="Search locked accounts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-xs text-charcoal focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12 transition-all"
              />
            </div>
            <button
              onClick={() => refetch()}
              className="p-2 border border-brand-light text-slate hover:text-charcoal hover:bg-slate-50 rounded-xl transition-all"
              title="Refresh list"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-brand-light text-brand-dark uppercase tracking-wider font-semibold">
                  {role === 'superadmin' && <th className="p-3.5 rounded-l-xl">Company</th>}
                  <th className={`p-3.5 ${role !== 'superadmin' ? 'rounded-l-xl' : ''}`}>Employee ID</th>
                  <th className="p-3.5">Email Address</th>
                  <th className="p-3.5">Lock Status</th>
                  <th className="p-3.5">Auto-Unlock Date</th>
                  <th className="p-3.5 rounded-r-xl text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-light">
                {filtered.map((emp) => (
                  <tr key={emp.id} className="hover:bg-brand-bg transition-colors">
                    {role === 'superadmin' && (
                      <td className="p-3.5 font-bold text-[#0A4D8C]">{emp.company_name}</td>
                    )}
                    <td className="p-3.5 font-mono text-slate">#{emp.external_employee_id}</td>
                    <td className="p-3.5 font-bold text-charcoal">{emp.email}</td>
                    <td className="p-3.5">
                      <LockCountdown lockUntil={emp.lock_until} />
                    </td>
                    <td className="p-3.5 text-slate font-mono text-[10px]">
                      {emp.lock_until ? format(new Date(emp.lock_until), 'yyyy-MM-dd HH:mm:ss') : 'N/A (Indefinite)'}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => {
                          if (confirm(`Are you sure you want to unlock ${emp.email}?`)) {
                            unlockMutation.mutate({ id: emp.external_employee_id, companyId: emp.company_id });
                          }
                        }}
                        className="px-3 py-1.5 bg-green-600 text-white text-[10px] font-bold rounded-lg hover:bg-green-700 transition-colors inline-flex items-center gap-1 shadow-sm hover:shadow"
                      >
                        <Unlock className="w-3.5 h-3.5" /> Unlock Account
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <div className="w-[80px] h-[80px] rounded-full bg-green-50 text-status-success flex items-center justify-center border border-green-100">
              <Unlock className="w-10 h-10" />
            </div>
            <h3 className="font-display font-semibold text-lg text-charcoal tracking-tight">No Locked Accounts</h3>
            <p className="text-sm text-slate max-w-sm">All employees are currently verified and active on the platform.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EmployeesDirectoryView({ token, role, companies, onOpenTimeline }) {
  const queryClient = useQueryClient();
  const { admin } = useAuthStore();
  const [companyFilter, setCompanyFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, locked
  const [sessionFilter, setSessionFilter] = useState('all'); // all, active, inactive
  const [sortBy, setSortBy] = useState('email'); // email, id, risk_score, last_login

  // Fetch employees query
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['employees', companyFilter],
    queryFn: async () => {
      const url = companyFilter 
        ? `${API_URL}/admin/employees?companyId=${companyFilter}`
        : `${API_URL}/admin/employees`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    refetchInterval: 5000,
  });

  // Mutation: Lock/Unlock Employee
  const lockMutation = useMutation({
    mutationFn: async ({ id, companyId, lock }) => {
      await axios.post(`${API_URL}/admin/employees/${id}/lock-action`, { lock, companyId }, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: (_, variables) => {
      toast.success(`Account successfully ${variables.lock ? 'locked' : 'unlocked'}`);
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['lockedEmployees'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to update employee lock status');
    }
  });

  // Mutation: Update Hours
  const updateHoursMutation = useMutation({
    mutationFn: async ({ id, companyId, startHour, endHour }) => {
      await axios.post(`${API_URL}/admin/employees/${id}/hours`, { startHour, endHour, companyId }, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      toast.success("Allowed login hours updated successfully!");
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to update allowed login hours');
    }
  });

  const getSessionDuration = (startedAt, lastActive) => {
    if (!startedAt) return 'N/A';
    const start = new Date(startedAt);
    const end = lastActive ? new Date(lastActive) : new Date();
    const diffMs = end - start;
    if (diffMs < 0) return '0s';
    const diffSecs = Math.floor(diffMs / 1000);
    const mins = Math.floor(diffSecs / 60);
    const hours = Math.floor(mins / 60);
    
    if (hours > 0) {
      return `${hours}h ${mins % 60}m`;
    }
    if (mins > 0) {
      return `${mins}m ${diffSecs % 60}s`;
    }
    return `${diffSecs}s`;
  };

  const getRiskScoreBadge = (score) => {
    if (score === null || score === undefined) return <span className="text-slate font-mono">-</span>;
    let colorClass = 'badge-glass-low';
    if (score >= 80) colorClass = 'badge-glass-critical';
    else if (score >= 50) colorClass = 'badge-glass-warning';
    else if (score >= 20) colorClass = 'badge-glass-medium';
    
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${colorClass}`}>
        {score}
      </span>
    );
  };

  let filtered = data?.employees || [];

  filtered = filtered.filter(emp => {
    const matchesSearch = searchQuery === '' || 
      emp.email.toLowerCase().includes(searchQuery.toLowerCase()) || 
      emp.external_employee_id.toString().includes(searchQuery);
    
    const isLocked = emp.is_locked && (!emp.lock_until || new Date(emp.lock_until) > new Date());
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'locked' && isLocked) ||
      (statusFilter === 'active' && !isLocked);

    const matchesSession = sessionFilter === 'all' ||
      (sessionFilter === 'active' && emp.is_session_active) ||
      (sessionFilter === 'inactive' && !emp.is_session_active);

    return matchesSearch && matchesStatus && matchesSession;
  });

  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'email') return a.email.localeCompare(b.email);
    if (sortBy === 'id') return a.external_employee_id - b.external_employee_id;
    if (sortBy === 'risk_score') return (b.last_risk_score || 0) - (a.last_risk_score || 0);
    if (sortBy === 'last_login') {
      const aTime = a.last_login_time ? new Date(a.last_login_time).getTime() : 0;
      const bTime = b.last_login_time ? new Date(b.last_login_time).getTime() : 0;
      return bTime - aTime;
    }
    return 0;
  });

  return (
    <div className="space-y-6">
      <div className="card-warden p-6">
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-base font-bold font-display text-charcoal">Employee Directory</h2>
              <p className="text-xs text-slate">View employee registries, session indicators, security telemetry, and toggle lock override controls.</p>
            </div>
            
            <button
              onClick={() => refetch()}
              className="p-2 border border-brand-light text-slate hover:text-charcoal hover:bg-slate-50 rounded-xl transition-all self-end md:self-auto"
              title="Refresh roster"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate" />
              <input
                type="text"
                placeholder="Search email or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-xs text-charcoal focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12 transition-all"
              />
            </div>

            {role === 'superadmin' ? (
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-xl text-xs text-charcoal focus:outline-none focus:border-[#0A4D8C] focus:bg-brand-light transition-all"
              >
                <option value="">All Companies</option>
                {companies?.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <div className="px-3 py-2 border border-gray-100 rounded-xl text-xs text-slate bg-gray-50 flex items-center font-bold">
                Tenant: {admin?.companyId || 'Local Company'}
              </div>
            )}

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-xl text-xs text-charcoal focus:outline-none focus:border-[#0A4D8C] focus:bg-brand-light transition-all"
            >
              <option value="all">All Account Statuses</option>
              <option value="active">Active Accounts</option>
              <option value="locked">Locked Accounts</option>
            </select>

            <select
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-xl text-xs text-charcoal focus:outline-none focus:border-[#0A4D8C] focus:bg-brand-light transition-all"
            >
              <option value="all">All Session States</option>
              <option value="active">Active Sessions</option>
              <option value="inactive">Inactive Sessions</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-xl text-xs text-charcoal focus:outline-none focus:border-[#0A4D8C] focus:bg-brand-light transition-all"
            >
              <option value="email">Sort by Email</option>
              <option value="id">Sort by Employee ID</option>
              <option value="risk_score">Sort by Risk Score</option>
              <option value="last_login">Sort by Last Login</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-brand-light text-brand-dark uppercase tracking-wider font-semibold">
                  {role === 'superadmin' && <th className="p-3.5 rounded-l-xl">Company</th>}
                  <th className={`p-3.5 ${role !== 'superadmin' ? 'rounded-l-xl' : ''}`}>Employee ID</th>
                  <th className="p-3.5">Email Address</th>
                  <th className="p-3.5">Allowed Hours (IST)</th>
                  <th className="p-3.5">Account Status</th>
                  <th className="p-3.5">Session Status</th>
                  <th className="p-3.5">Session Time</th>
                  <th className="p-3.5">Last Location / IP</th>
                  <th className="p-3.5">Risk Score</th>
                  <th className="p-3.5 rounded-r-xl text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-light">
                {filtered.map((emp) => {
                  const isLocked = emp.is_locked && (!emp.lock_until || new Date(emp.lock_until) > new Date());
                  return (
                    <tr key={emp.id} className="hover:bg-brand-bg transition-colors">
                      {role === 'superadmin' && (
                        <td className="p-3.5 font-bold text-[#0A4D8C]">{emp.company_name}</td>
                      )}
                      <td className="p-3.5 font-mono text-slate">#{emp.external_employee_id}</td>
                      <td className="p-3.5 font-bold text-charcoal">{emp.email}</td>
                      
                      <td className="p-3.5 font-semibold text-charcoal">
                        {(emp.allowed_start_hour !== undefined && emp.allowed_start_hour !== null ? emp.allowed_start_hour : 8).toString().padStart(2, '0')}:00 - {(emp.allowed_end_hour !== undefined && emp.allowed_end_hour !== null ? emp.allowed_end_hour : 17).toString().padStart(2, '0')}:00
                      </td>
                      
                      <td className="p-3.5">
                        {isLocked ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-status-warning border border-amber-100">
                            <Lock className="w-3 h-3" /> Locked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-status-success border border-green-100">
                            <Unlock className="w-3 h-3" /> Active
                          </span>
                        )}
                        {emp.is_locked && emp.lock_until && new Date(emp.lock_until) > new Date() && (
                          <div className="text-[9px] text-slate mt-1">
                            Expires: {format(new Date(emp.lock_until), 'HH:mm:ss')}
                          </div>
                        )}
                      </td>

                      <td className="p-3.5">
                        {emp.is_session_active ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F4FD] text-brand-medium border border-[#D0E8F9]">
                            <span className="pulse-indicator w-2 h-2 mr-1"></span> Active Session
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-50 text-slate border border-gray-200">
                            Inactive
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 font-mono text-[10px] text-slate">
                        {emp.is_session_active ? getSessionDuration(emp.session_started_at, emp.session_last_active) : 'N/A'}
                      </td>

                      <td className="p-3.5 text-slate font-mono text-[10px]">
                        {emp.last_login_time ? (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-charcoal">
                              {emp.last_login_city || 'Unknown'}, {emp.last_login_country || 'Unknown'}
                            </div>
                            <div>{emp.last_login_ip}</div>
                            <div className="text-[9px] text-slate/70">
                              {format(new Date(emp.last_login_time), 'yyyy-MM-dd HH:mm:ss')}
                            </div>
                          </div>
                        ) : (
                          'No logins registered'
                        )}
                      </td>

                      <td className="p-3.5">
                        {getRiskScoreBadge(emp.last_risk_score)}
                      </td>

                      <td className="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                        {(role === 'superadmin' || role === 'companyadmin') && (
                          <button
                            onClick={() => {
                              const start = prompt("Enter Allowed Start Hour (0-23) in IST:", emp.allowed_start_hour !== undefined && emp.allowed_start_hour !== null ? emp.allowed_start_hour : 8);
                              if (start === null) return;
                              const end = prompt("Enter Allowed End Hour (0-23) in IST:", emp.allowed_end_hour !== undefined && emp.allowed_end_hour !== null ? emp.allowed_end_hour : 17);
                              if (end === null) return;
                              const startHour = parseInt(start, 10);
                              const endHour = parseInt(end, 10);
                              if (isNaN(startHour) || isNaN(endHour) || startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
                                alert("Invalid hours. Please enter numbers between 0 and 23.");
                                return;
                              }
                              updateHoursMutation.mutate({ id: emp.external_employee_id, companyId: emp.company_id, startHour, endHour });
                            }}
                            className="px-2.5 py-1.5 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-1 shadow-sm hover:shadow"
                          >
                            <Clock className="w-3 h-3" /> Set Allowed Hours
                          </button>
                        )}
                        {isLocked ? (
                          <button
                            onClick={() => {
                              if (confirm(`Unlock account for ${emp.email}?`)) {
                                lockMutation.mutate({ id: emp.external_employee_id, companyId: emp.company_id, lock: false });
                              }
                            }}
                            className="px-2.5 py-1.5 bg-green-600 text-white text-[10px] font-bold rounded-lg hover:bg-green-700 transition-colors inline-flex items-center gap-1 shadow-sm hover:shadow"
                          >
                            <Unlock className="w-3 h-3" /> Unlock
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (confirm(`Manually lock account for ${emp.email}? This will invalidate active sessions.`)) {
                                lockMutation.mutate({ id: emp.external_employee_id, companyId: emp.company_id, lock: true });
                              }
                            }}
                            className="px-2.5 py-1.5 bg-[#D93025] text-white text-[10px] font-bold rounded-lg hover:bg-red-700 transition-colors inline-flex items-center gap-1 shadow-sm hover:shadow"
                          >
                            <Lock className="w-3 h-3" /> Lock Account
                          </button>
                        )}
                        <button
                          onClick={() => onOpenTimeline(emp.external_employee_id, emp.company_id)}
                          className="px-2.5 py-1.5 bg-[#E4EBF5] text-charcoal text-[10px] font-bold rounded-lg hover:bg-[#D0DDF0] transition-colors inline-flex items-center gap-1 border border-brand-light"
                        >
                          <History className="w-3 h-3" /> Timeline
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
            <div className="w-[80px] h-[80px] rounded-full bg-blue-50 text-brand-medium flex items-center justify-center border border-blue-100">
              <Users className="w-10 h-10" />
            </div>
            <h3 className="font-display font-semibold text-lg text-charcoal tracking-tight">No Employees Found</h3>
            <p className="text-sm text-slate max-w-sm">No employees match the selected criteria or search term.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function RiskSettingsView({ token }) {
  const queryClient = useQueryClient();
  const [formValues, setFormValues] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  // Fetch settings query
  const { data, isLoading, error } = useQuery({
    queryKey: ['systemSettings'],
    queryFn: async () => {
      const res = await axios.get(`${API_URL}/admin/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
  });

  // Populate form values once loaded
  useEffect(() => {
    if (data?.settings) {
      const vals = {};
      data.settings.forEach(s => {
        vals[s.key] = s.value;
      });
      setFormValues(vals);
    }
  }, [data]);

  const handleInputChange = (key, value) => {
    setFormValues(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload = Object.entries(formValues).map(([key, value]) => ({
        key,
        value: value.toString()
      }));

      await axios.post(`${API_URL}/admin/settings`, { settings: payload }, {
        headers: { Authorization: `Bearer ${token}` },
      });

      toast.success('Risk engine configurations updated and synchronized!');
      queryClient.invalidateQueries({ queryKey: ['systemSettings'] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update system configurations');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="card-warden p-8 text-center text-xs text-slate">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading risk engine settings ledger...
      </div>
    );
  }

  // Helper to render a slider configuration row
  const renderSlider = (key, label, min, max, step = 1, suffix = '') => {
    const val = formValues[key] !== undefined ? parseFloat(formValues[key]) : min;
    const settingObj = data?.settings?.find(s => s.key === key) || {};
    
    return (
      <div key={key} className="p-4 bg-white rounded-xl border border-brand-light flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="md:max-w-md">
          <label className="text-xs font-bold text-charcoal block uppercase tracking-wider">{label}</label>
          <span className="text-[10px] text-slate block mt-0.5">{settingObj.description || ''}</span>
        </div>
        <div className="flex items-center gap-4 shrink-0 w-full md:w-72">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={val}
            onChange={(e) => handleInputChange(key, e.target.value)}
            className="flex-1 accent-[#0A4D8C]"
          />
          <div className="w-16 flex items-center gap-1">
            <input
              type="number"
              min={min}
              max={max}
              value={val}
              onChange={(e) => handleInputChange(key, e.target.value)}
              className="w-12 px-1.5 py-1 text-xs border rounded font-mono text-center text-charcoal font-bold"
            />
            <span className="text-[10px] text-slate font-bold">{suffix}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      
      {/* 1. Evaluation Thresholds */}
      <div className="card-warden p-6 space-y-4">
        <div>
          <h2 className="text-sm font-bold uppercase text-[#0A4D8C] tracking-wider">Evaluation Action Thresholds</h2>
          <p className="text-xs text-slate mt-0.5">Determine the risk score limits required to trigger active defensive overrides.</p>
        </div>
        <div className="space-y-3">
          {renderSlider('threshold_lockout', 'Account Lockout Limit', 50, 100, 1, 'pts')}
          {renderSlider('threshold_block', 'Block Recommendation Limit', 30, 90, 1, 'pts')}
          {renderSlider('threshold_mfa', 'Secondary MFA OTP Challenge Limit', 10, 80, 1, 'pts')}
        </div>
      </div>

      {/* 2. Threat Vector Weights */}
      <div className="card-warden p-6 space-y-4">
        <div>
          <h2 className="text-sm font-bold uppercase text-[#0A4D8C] tracking-wider">Security Rule Severity Weights</h2>
          <p className="text-xs text-slate mt-0.5">Adjust how much risk points each specific category anomaly contributes to the total score.</p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {renderSlider('weight_failed_login', 'Failed Logins Multiplier', 1, 50, 1, 'pts')}
          {renderSlider('weight_time_of_day', 'Outside Working Hours Weight', 0, 50, 1, 'pts')}
          {renderSlider('weight_new_device', 'New Device / Browser Weight', 0, 50, 1, 'pts')}
          {renderSlider('weight_high_risk_country', 'High-Risk Geolocation Weight', 0, 100, 1, 'pts')}
          {renderSlider('weight_new_country', 'New Country Travel Weight', 0, 100, 1, 'pts')}
          {renderSlider('weight_geo_distance', 'Geofence Exceeded Weight', 0, 50, 1, 'pts')}
          {renderSlider('weight_concurrent_session', 'Concurrent Active Session Conflict Weight', 0, 50, 1, 'pts')}
        </div>
      </div>

      {/* 3. Parameter Limits */}
      <div className="card-warden p-6 space-y-4">
        <div>
          <h2 className="text-sm font-bold uppercase text-[#0A4D8C] tracking-wider">Geographic & Account Lock limits</h2>
          <p className="text-xs text-slate mt-0.5">Specify baseline boundary sizes and brute force attempt thresholds.</p>
        </div>
        <div className="space-y-3">
          {renderSlider('limit_geo_distance', 'Geofence Distance Threshold', 10, 1000, 10, 'km')}
          {renderSlider('limit_impossible_travel_speed', 'Impossible Speed threshold', 100, 5000, 50, 'km/h')}
          {renderSlider('failures_lockout', 'Failed password count: Lockout', 3, 15, 1, 'fails')}
          {renderSlider('failures_block', 'Failed password count: Captcha Block', 2, 10, 1, 'fails')}
          {renderSlider('failures_warn', 'Failed password count: Warning Alert', 1, 5, 1, 'fails')}
        </div>
      </div>

      {/* Save panel */}
      <div className="flex justify-end gap-3 card-warden p-4">
        <button
          type="button"
          onClick={() => {
            const vals = {};
            data.settings.forEach(s => {
              vals[s.key] = s.value;
            });
            setFormValues(vals);
            toast.success('Configuration values reset to loaded values');
          }}
          className="px-4 py-2 border rounded-xl text-xs text-charcoal hover:bg-slate-50 font-bold"
        >
          Reset Changes
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="px-6 py-2 bg-[#0A4D8C] hover:bg-[#0D6EB8] text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm active:scale-98 transition-all disabled:opacity-50"
        >
          {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
          Apply & Sync Risk Engine Settings
        </button>
      </div>
    </form>
  );
}

function MainApp() {
  const { token, admin, sidebarCollapsed, alerts, setAuth, logout, toggleSidebar, addAlert, setInitialAlerts, isMuted, toggleMute } = useAuthStore();
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard, companies, alerts, employees, logs
  const [displayTab, setDisplayTab] = useState('dashboard');
  const [fadeState, setFadeState] = useState('opacity-100');

  useEffect(() => {
    setFadeState('opacity-0 transition-opacity duration-120 ease-in-out');
    const timer = setTimeout(() => {
      setDisplayTab(activeTab);
      setFadeState('opacity-100 transition-opacity duration-200 ease-in-out');
    }, 120);
    return () => clearTimeout(timer);
  }, [activeTab]);

  useEffect(() => {
    const hasCritical = alerts.some(a => a.severity === 'critical' && a.status === 'active');
    updateFavicon(hasCritical);
  }, [alerts]);

  const [newAlertPulse, setNewAlertPulse] = useState(false);
  
  useEffect(() => {
    if (alerts.length > 0) {
      setNewAlertPulse(true);
      const timer = setTimeout(() => setNewAlertPulse(false), 600);
      return () => clearTimeout(timer);
    }
  }, [alerts.length]);

  const [searchQuery, setSearchQuery] = useState('');
  
  // Login input
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Modals state
  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [onboardedDetails, setOnboardedDetails] = useState(null);
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [employeeRosterInput, setEmployeeRosterInput] = useState('');
  
  // Lock confirmation modal
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockTarget, setLockTarget] = useState(null); // { id, email, lock: boolean }
  const [confirmEnabled, setConfirmEnabled] = useState(false);

  useEffect(() => {
    if (showLockModal) {
      setConfirmEnabled(false);
      const timer = setTimeout(() => {
        setConfirmEnabled(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [showLockModal]);

  // Timeline view state
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedEmployeeCompanyId, setSelectedEmployeeCompanyId] = useState('');
  const [showTimelineModal, setShowTimelineModal] = useState(false);

  const queryClientRef = useQueryClient();

  // Onboard Form inputs
  const [companyIdInput, setCompanyIdInput] = useState('');
  const [companyNameInput, setCompanyNameInput] = useState('');
  const [companyDomainInput, setCompanyDomainInput] = useState('');
  const [companyCallbackInput, setCompanyCallbackInput] = useState('');

  // Axios response interceptor for token rotation
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response && error.response.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          try {
            const refreshRes = await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true });
            const newAccessToken = refreshRes.data.token;
            setAuth(newAccessToken, refreshRes.data.admin);
            originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
            return axios(originalRequest);
          } catch (refreshErr) {
            logout();
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, [setAuth, logout]);

  // Connect WebSockets for Real-time alerts
  useEffect(() => {
    if (!token || !admin) return;

    const socket = io(SOCKET_URL, {
      query: {
        role: admin.role,
        companyId: admin.companyId || '',
      },
    });

    socket.on('new_alert', (newAlert) => {
      addAlert(newAlert);
      playWarningChime(newAlert.severity);
      
      toast.custom((t) => (
        <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-sm w-full bg-white shadow-xl rounded-xl pointer-events-auto flex border-l-4 ${
          newAlert.severity === 'critical' ? 'border-status-critical' :
          newAlert.severity === 'high' ? 'border-status-warning' : 'border-brand-medium'
        } p-4 relative`}>
          <div className="flex-1">
            <p className="text-xs font-bold text-charcoal">REAL-TIME {newAlert.severity.toUpperCase()} ALERT</p>
            <p className="text-xs text-slate mt-1">{newAlert.reason}</p>
            <span className="text-[10px] text-slate mt-1 block">User: {newAlert.email}</span>
          </div>
          <button onClick={() => toast.dismiss(t.id)} className="absolute right-2 top-2 text-slate hover:text-charcoal text-xs">✕</button>
        </div>
      ), { duration: 4000 });

      // Invalidate dashboard metrics to force updates
      queryClientRef.invalidateQueries({ queryKey: ['dashboardStats'] });
      queryClientRef.invalidateQueries({ queryKey: ['alerts'] });
    });

    return () => {
      socket.disconnect();
    };
  }, [token, admin, addAlert, queryClientRef]);

  // Query: Stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboardStats', admin?.companyId],
    queryFn: async () => {
      const res = await axios.get(`${API_URL}/admin/dashboard-stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    enabled: !!token && !!admin,
    refetchInterval: 15000, // Autorefresh stats every 15s
  });

  // Query: Alerts Feed
  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', searchQuery],
    queryFn: async () => {
      const res = await axios.get(`${API_URL}/admin/alerts?search=${searchQuery}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Synchronise store alerts
      if (res.data.alerts) {
        setInitialAlerts(res.data.alerts);
      }
      return res.data;
    },
    enabled: !!token && !!admin,
  });

  // Query: Companies (Super Admin only)
  const { data: companiesData } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const res = await axios.get(`${API_URL}/admin/companies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    enabled: !!token && admin?.role === 'superadmin',
  });

  // Query: Audit Logs
  const { data: auditData } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: async () => {
      const res = await axios.get(`${API_URL}/admin/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    enabled: !!token && activeTab === 'logs',
  });

  // Query: Employee Timeline
  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ['timeline', selectedEmployeeId, selectedEmployeeCompanyId],
    queryFn: async () => {
      const res = await axios.get(`${API_URL}/admin/employees/${selectedEmployeeId}/timeline?companyId=${selectedEmployeeCompanyId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    enabled: !!token && !!selectedEmployeeId && showTimelineModal,
  });

  // Mutation: Acknowledge Alert
  const ackMutation = useMutation({
    mutationFn: async ({ alertId, action }) => {
      await axios.post(`${API_URL}/admin/alerts/${alertId}/action`, { status: action }, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      toast.success('Alert updated successfully');
      queryClientRef.invalidateQueries({ queryKey: ['alerts'] });
      queryClientRef.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to update alert');
    }
  });

  // Mutation: Lock / Unlock Employee
  const lockMutation = useMutation({
    mutationFn: async ({ employeeId, lock }) => {
      await axios.post(`${API_URL}/admin/employees/${employeeId}/lock-action`, { lock }, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      toast.success('Callback action executed successfully');
      setShowLockModal(false);
      queryClientRef.invalidateQueries({ queryKey: ['dashboardStats'] });
      queryClientRef.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to execute callback lock');
    }
  });

  // Mutation: Onboard Company
  const onboardMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await axios.post(`${API_URL}/admin/companies`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    },
    onSuccess: (data) => {
      toast.success('Company onboarded successfully!');
      setOnboardedDetails(data);
      queryClientRef.invalidateQueries({ queryKey: ['companies'] });
      // Reset inputs
      setCompanyIdInput('');
      setCompanyNameInput('');
      setCompanyDomainInput('');
      setCompanyCallbackInput('');
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to onboard company');
    }
  });

  // Mutation: Sync Roster
  const rosterMutation = useMutation({
    mutationFn: async ({ companyId, roster }) => {
      await axios.post(`${API_URL}/admin/companies/${companyId}/sync-roster`, roster, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    onSuccess: () => {
      toast.success('Roster synchronized successfully!');
      setShowRosterModal(false);
      setEmployeeRosterInput('');
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to sync roster');
    }
  });

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await axios.post(`${API_URL}/auth/login`, {
        email: loginEmail,
        password: loginPassword,
      });
      setAuth(res.data.token, res.data.admin);
      toast.success('Welcome back, Administrator');
    } catch (err) {
      setLoginError(err.response?.data?.error || 'Invalid credentials');
    }
  };

  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  // Onboard Company Form submit
  const handleOnboardSubmit = (e) => {
    e.preventDefault();
    onboardMutation.mutate({
      id: companyIdInput,
      name: companyNameInput,
      domain: companyDomainInput,
      callbackUrl: companyCallbackInput,
    });
  };

  // Sync roster submit
  const handleRosterSubmit = (e) => {
    e.preventDefault();
    try {
      const parsedRoster = JSON.parse(employeeRosterInput);
      if (!Array.isArray(parsedRoster)) {
        throw new Error('Roster must be a valid JSON array');
      }
      rosterMutation.mutate({ companyId: selectedCompanyId, roster: parsedRoster });
    } catch (err) {
      toast.error('Roster error: Must be a valid JSON array of employees.');
    }
  };

  // If not logged in, render Admin Login screen
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-dark overflow-hidden relative">
        {/* Subtle grid elements */}
        <div className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        
        <div className="w-[400px] bg-white rounded-2xl shadow-2xl p-8 z-10">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 bg-brand-light text-brand-dark rounded-xl flex items-center justify-center mb-2">
              <Shield className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-bold font-display text-charcoal">Warden Monitoring</h1>
            <p className="text-xs text-slate mt-1">Super Admin & Company Admin Gateway</p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 bg-red-50 border-l-4 border-status-critical rounded text-xs text-status-critical flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-charcoal uppercase tracking-wider mb-1">Admin Email</label>
              <input
                type="email"
                required
                placeholder="admin@company.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm text-charcoal placeholder-slate focus:outline-none focus:border-brand-dark focus:bg-brand-light transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-charcoal uppercase tracking-wider mb-1">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm text-charcoal placeholder-slate focus:outline-none focus:border-brand-dark focus:bg-brand-light transition-all"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-brand-dark text-white rounded-lg font-medium text-sm hover:bg-brand-medium active:scale-98 transition-all"
            >
              Authenticate Admin
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Pre-formatted Recharts cell colors
  const COLORS = ['#2E9E6B', '#1A7FBF', '#F5A623', '#D93025'];

  return (
    <div className="min-h-screen flex bg-[#F4F7FB] text-charcoal overflow-hidden font-sans select-none">
      
      {/* 1. COLLAPSIBLE LEFT SIDEBAR */}
      <div 
        className={`shrink-0 bg-[#0A4D8C] text-white flex flex-col justify-between transition-all duration-300 sidebar-texture shadow-[2px_0_10px_rgba(10,77,140,0.08)] relative z-30 ${
          sidebarCollapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div>
          {/* Logo & Collapse Header */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-white/10 bg-[#0A4D8C]/50 z-20">
            {!sidebarCollapsed ? (
              <div className="flex items-center gap-2">
                <Shield className="w-6 h-6 text-white" />
                <span className="font-display font-semibold text-base tracking-wide text-white">WARDEN CORE</span>
              </div>
            ) : (
              <Shield className="w-6 h-6 text-white mx-auto" />
            )}
            <button onClick={toggleSidebar} className="text-white/70 hover:text-white transition-colors">
              {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="mt-6 px-2 space-y-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full py-2.5 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all duration-150 ${
                activeTab === 'dashboard' ? 'nav-active-pill shadow-sm' : 'nav-inactive'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" />
              {!sidebarCollapsed && <span>Dashboard</span>}
            </button>

            {admin?.role === 'superadmin' && (
              <button
                onClick={() => setActiveTab('companies')}
                className={`w-full py-2.5 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all duration-150 ${
                  activeTab === 'companies' ? 'nav-active-pill shadow-sm' : 'nav-inactive'
                }`}
              >
                <Building2 className="w-5 h-5" />
                {!sidebarCollapsed && <span>Companies</span>}
              </button>
            )}

            <button
              onClick={() => setActiveTab('alerts')}
              className={`w-full py-2.5 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all duration-150 relative ${
                activeTab === 'alerts' ? 'nav-active-pill shadow-sm' : 'nav-inactive'
              }`}
            >
              <AlertOctagon className="w-5 h-5" />
              {!sidebarCollapsed && <span>Alert Feed</span>}
              {alerts.filter(a => a.status === 'active').length > 0 && (
                <span className="absolute right-3 bg-white text-[#0A4D8C] font-bold text-[10px] px-1.5 py-0.5 rounded-full shadow-sm animate-pulse">
                  {alerts.filter(a => a.status === 'active').length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('employees')}
              className={`w-full py-2.5 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all duration-150 ${
                activeTab === 'employees' ? 'nav-active-pill shadow-sm' : 'nav-inactive'
              }`}
            >
              <Users className="w-5 h-5" />
              {!sidebarCollapsed && <span>Employees</span>}
            </button>

            <button
              onClick={() => setActiveTab('locked')}
              className={`w-full py-2.5 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all duration-150 ${
                activeTab === 'locked' ? 'nav-active-pill shadow-sm' : 'nav-inactive'
              }`}
            >
              <Lock className="w-5 h-5" />
              {!sidebarCollapsed && <span>Locked Accounts</span>}
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`w-full py-2.5 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all duration-150 ${
                activeTab === 'logs' ? 'nav-active-pill shadow-sm' : 'nav-inactive'
              }`}
            >
              <History className="w-5 h-5" />
              {!sidebarCollapsed && <span>Audit Log</span>}
            </button>

            {admin?.role === 'superadmin' && (
              <button
                onClick={() => setActiveTab('settings')}
                className={`w-full py-2.5 px-3.5 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all duration-150 ${
                  activeTab === 'settings' ? 'nav-active-pill shadow-sm' : 'nav-inactive'
                }`}
              >
                <Sliders className="w-5 h-5" />
                {!sidebarCollapsed && <span>Risk Configurations</span>}
              </button>
            )}
          </nav>
        </div>

        {/* Logout widget */}
        <div className="p-3 border-t border-white/10 bg-[#071F3C]/40">
          <button
            onClick={logout}
            className="w-full py-2.5 rounded-xl flex items-center justify-center gap-3 text-xs font-bold hover:bg-[#D93025] hover:text-white transition-all text-white/70 transform hover:-translate-y-[1px] active:translate-y-0 active:scale-95 shadow-sm"
          >
            <LogOut className="w-4 h-4" />
            {!sidebarCollapsed && <span>Logout Session</span>}
          </button>
        </div>
      </div>

      {/* Main content viewport */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* 2. TOP HEADER */}
        <header className="h-16 flex items-center justify-between px-6 shrink-0 z-20 header-glass">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-[#6B7FA3] font-bold">Warden Security Platform</span>
            <div className="h-4 w-px bg-brand-light mx-2"></div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-brand-light text-brand-dark">
              {admin?.role === 'superadmin' ? 'Super Admin Portal' : `Tenant: ${admin?.companyId}`}
            </span>
            <div className="h-4 w-px bg-brand-light mx-2"></div>
            
            {/* Live Socket Connection indicator */}
            <div className="flex items-center gap-1.5 bg-[#E8F4FD] px-2 py-0.5 rounded-full text-[10px] font-bold text-[#0A4D8C] shadow-sm">
              <span className="pulse-indicator"></span>
              <span>LIVE SIGNAL</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Bell Alerts count */}
            <div className="relative cursor-pointer text-slate hover:text-charcoal transition-colors p-1" onClick={() => setActiveTab('alerts')}>
              <Bell className="w-5 h-5" />
              {alerts.filter(a => a.status === 'active').length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-status-critical text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-sm animate-bounce">
                  {alerts.filter(a => a.status === 'active').length}
                </span>
              )}
            </div>
            
            {/* Audio Accessibility Mute Toggle */}
            <button 
              onClick={toggleMute} 
              className="text-slate hover:text-charcoal transition-colors p-1.5 rounded-lg hover:bg-[#E8F4FD] flex items-center justify-center border border-transparent hover:border-[#0A4D8C]/10"
              title={isMuted ? 'Unmute alerts' : 'Mute alerts'}
            >
              {isMuted ? <VolumeX className="w-5 h-5 text-status-critical" /> : <Volume2 className="w-5 h-5 text-brand-medium" />}
            </button>
            <div className="h-6 w-px bg-brand-light"></div>
            
            {/* User Profile */}
            <div className="flex items-center gap-2 text-right">
              <span className="text-xs font-bold text-charcoal block leading-tight">{admin?.email}</span>
              <span className="text-[10px] text-[#6B7FA3] block leading-tight font-medium">
                {admin?.role === 'superadmin' ? 'Platform Administrator' : 'Tenant Security Admin'}
              </span>
            </div>
          </div>
        </header>

        {/* 3. DYNAMIC CONTENT AREA */}
        <main className="flex-1 p-6 overflow-y-auto bg-[#F4F7FB] relative">
          
          <div className={fadeState}>
            {/* Dashboard view */}
            {displayTab === 'dashboard' && (
            <div className="space-y-6">
              
              {/* Stat Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {admin?.role === 'superadmin' && (
                  <div className="card-warden card-warden-hover p-5 flex flex-col justify-between min-h-[160px]">
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-bold text-[#6B7FA3] uppercase tracking-wider">Active Tenants</span>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-blue-50 text-[#0A4D8C]">
                        <Building2 className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-3">
                      <StatNumber value={stats?.companiesCount || 0} />
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-light">
                      <Sparkline data={[2, 3, 2, 4, 3, 4, stats?.companiesCount || 4]} color="#0A4D8C" />
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-50 text-status-success font-tabular">+12%</span>
                    </div>
                  </div>
                )}
                
                <div className="card-warden card-warden-hover p-5 flex flex-col justify-between min-h-[160px]">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-[#6B7FA3] uppercase tracking-wider">Registered Rosters</span>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-blue-50 text-[#0A4D8C]">
                      <Users className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <StatNumber value={stats?.employeeCount || 0} />
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-light">
                    <Sparkline data={[10, 12, 15, 14, 18, 20, stats?.employeeCount || 20]} color="#1A7FBF" />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-50 text-status-success font-tabular">+8%</span>
                  </div>
                </div>

                <div className="card-warden card-warden-hover p-5 flex flex-col justify-between min-h-[160px]">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-[#6B7FA3] uppercase tracking-wider">Live Active Sessions</span>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-sky-50 text-[#1A7FBF] relative">
                      <UserCheck className="w-4 h-4" />
                      <span className="absolute -top-0.5 -right-0.5 pulse-indicator"></span>
                    </div>
                  </div>
                  <div className="mt-3">
                    <StatNumber value={stats?.activeSessionsCount || 0} />
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-light">
                    <Sparkline data={[2, 5, 8, 4, 9, 7, stats?.activeSessionsCount || 7]} color="#1A7FBF" />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-[#1A7FBF] font-tabular">+15%</span>
                  </div>
                </div>

                <div className="card-warden card-warden-hover p-5 flex flex-col justify-between min-h-[160px]">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-[#6B7FA3] uppercase tracking-wider">Attack Logged</span>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center bg-red-50 text-status-critical">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <StatNumber value={stats?.attacksCount || 0} />
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-light">
                    <Sparkline data={[30, 45, 25, 60, 40, 55, stats?.attacksCount || 55]} color="#D93025" />
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-50 text-status-success font-tabular">-4%</span>
                  </div>
                </div>

                {admin?.role === 'company_admin' && (
                  <div className="card-warden card-warden-hover p-5 flex flex-col justify-between min-h-[160px]">
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-bold text-[#6B7FA3] uppercase tracking-wider">Threat Incidents</span>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-amber-50 text-status-warning">
                        <AlertOctagon className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="mt-3">
                      <StatNumber value={stats?.alertsCount?.critical + stats?.alertsCount?.high || 0} />
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-light">
                      <Sparkline data={[0, 1, 0, 3, 1, 2, (stats?.alertsCount?.critical + stats?.alertsCount?.high) || 2]} color="#F5A623" />
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-status-warning font-tabular">+20%</span>
                    </div>
                  </div>
                )}

                <div className="card-warden card-warden-hover p-5 flex flex-col justify-between min-h-[160px]">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-[#6B7FA3] uppercase tracking-wider">Security Posture</span>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      stats?.securityPosture === 'Critical' ? 'bg-red-50 text-status-critical' :
                      stats?.securityPosture === 'High' ? 'bg-amber-50 text-status-warning' :
                      stats?.securityPosture === 'Medium' ? 'bg-blue-50 text-brand-medium' : 'bg-green-50 text-status-success'
                    }`}>
                      <Shield className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="mt-3">
                    <span className={`font-display font-bold text-3xl leading-none ${
                      stats?.securityPosture === 'Critical' ? 'text-status-critical animate-pulse' :
                      stats?.securityPosture === 'High' ? 'text-status-warning' :
                      stats?.securityPosture === 'Medium' ? 'text-[#1A7FBF]' : 'text-status-success'
                    }`}>
                      {stats?.securityPosture || 'Safe'}
                    </span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-brand-light flex items-center justify-between">
                    <span className="text-[10px] text-[#6B7FA3] font-semibold">24H ROLLING EVAL</span>
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      stats?.securityPosture === 'Safe' ? 'bg-status-success' : 'bg-status-critical animate-ping'
                    }`}></span>
                  </div>
                </div>
              </div>

              {/* Graphical Insights & Live Alert Feed (1/3 - 2/3 Grid Layout) */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Left Column: Analytics Panels (1/3) */}
                <div className="lg:col-span-1 space-y-6">
                  
                  {/* Attack Volume Trends */}
                  <div className="card-warden p-6">
                    <h3 className="text-xs font-bold uppercase text-[#6B7FA3] tracking-wider mb-4">Attack Volume Trends</h3>
                    <div className="h-48">
                      {stats?.trends && stats.trends.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={stats.trends}>
                            <defs>
                              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#1A7FBF" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#1A7FBF" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(10,77,140,0.04)" />
                            <XAxis dataKey="day" tickFormatter={(t) => format(new Date(t), 'MMM dd')} tick={{ fontSize: 9, fill: '#6B7FA3' }} />
                            <YAxis tick={{ fontSize: 9, fill: '#6B7FA3' }} />
                            <Tooltip contentStyle={{ fontSize: 10, fontFamily: 'DM Sans', borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                            <Area type="monotone" dataKey="count" name="Attacks" stroke="#1A7FBF" strokeWidth={2} fillOpacity={1} fill="url(#colorCount)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-slate font-semibold">No recent attacks recorded.</div>
                      )}
                    </div>
                  </div>

                  {/* Ingestion Risk Distribution */}
                  <div className="card-warden p-6">
                    <h3 className="text-xs font-bold uppercase text-[#6B7FA3] tracking-wider mb-4">Ingestion Risk Tiers</h3>
                    <div className="h-48 flex items-center justify-around">
                      {stats?.riskDistribution && stats.riskDistribution.length > 0 ? (
                        <>
                          <div className="w-1/2 h-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={stats.riskDistribution}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={45}
                                  outerRadius={65}
                                  fill="#8884d8"
                                  paddingAngle={4}
                                  dataKey="count"
                                  nameKey="tier"
                                >
                                  {stats.riskDistribution.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="text-[10px] space-y-2.5 font-bold uppercase text-[#6B7FA3]">
                            {stats.riskDistribution.map((entry, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                                <span>{entry.count} Logins</span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate font-semibold">No events logged.</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Live Alert Feed Centerpiece (2/3) */}
                <div className="lg:col-span-2">
                  <div className="card-warden p-6 relative overflow-hidden flex flex-col justify-between min-h-[500px]">
                    
                    {/* Glowing Live Progress Line */}
                    {newAlertPulse && <div className="live-progress-line" />}

                    {/* Feed Header */}
                    <div className="flex justify-between items-center border-b border-[#E8F4FD] pb-4 mb-4">
                      <div className="flex items-center gap-2">
                        <span className="pulse-indicator"></span>
                        <h3 className="text-xs font-bold uppercase text-slate tracking-wider">Real-Time Threat Center</h3>
                      </div>
                      <span className="text-[10px] font-bold text-brand-medium bg-brand-light px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse">
                        Socket.IO Live
                      </span>
                    </div>

                    {/* Feed Scrolling stream */}
                    <div className="max-h-[460px] overflow-y-auto space-y-3 pr-1.5 flex-1">
                      {alertsLoading ? (
                        <AlertFeedSkeleton />
                      ) : alerts && alerts.length > 0 ? (
                        alerts.map((alert) => {
                          const isAck = alert.status === 'acknowledged';
                          const isCrit = alert.severity === 'critical';
                          const color = isAck ? '#2E9E6B' : (isCrit ? '#D93025' : alert.severity === 'high' ? '#F5A623' : '#1A7FBF');
                          
                          return (
                            <div
                              key={alert.id}
                              style={{
                                opacity: isAck ? '0.6' : '1',
                                background: (!isAck && isCrit) ? 'linear-gradient(90deg, rgba(217,48,37,0.04) 0%, transparent 120px)' : '#FFFFFF'
                              }}
                              className="group p-4 border border-[#E8F4FD] rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 relative pl-6 hover:shadow-[0_2px_8px_rgba(10,77,140,0.05)] alert-row-appear"
                            >
                              {/* Left Accent Color bar */}
                              <div 
                                className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition-colors duration-300"
                                style={{ backgroundColor: color }}
                              />

                              {/* Alert Details */}
                              <div className="space-y-1 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                    isCrit ? 'badge-glass-critical' :
                                    alert.severity === 'high' ? 'badge-glass-warning' :
                                    alert.severity === 'medium' ? 'badge-glass-medium' : 'badge-glass-low'
                                  }`}>
                                    {alert.severity}
                                  </span>
                                  {alert.risk_score !== undefined && (
                                    <span className="text-[9px] font-bold bg-[#E8F4FD] text-[#0A4D8C] px-1.5 py-0.5 rounded">
                                      Risk Score: {alert.risk_score}/100
                                    </span>
                                  )}
                                  <span className="text-[10px] text-[#6B7FA3] font-semibold font-mono">
                                    {formatDistanceToNow(new Date(alert.created_at || alert.timestamp))} ago
                                  </span>
                                </div>
                                <h4 className="text-sm font-bold text-charcoal">{alert.reason}</h4>
                                <p className="text-xs text-slate font-medium">
                                  User: <span className="text-[#0A4D8C] font-semibold">{alert.email}</span>
                                </p>
                              </div>

                              {/* Hover Action buttons */}
                              <div className="flex items-center gap-2 self-end md:self-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                                {!isAck ? (
                                  <>
                                    <button
                                      onClick={() => ackMutation.mutate({ alertId: alert.id, action: 'acknowledged' })}
                                      className="p-1.5 border border-brand-light text-status-success hover:bg-green-50 rounded-lg transition-all"
                                      title="Acknowledge alert"
                                    >
                                      <Check className="w-4 h-4" />
                                    </button>
                                    {alert.employee_id && (
                                      <>
                                        <button
                                          onClick={() => {
                                            setSelectedEmployeeId(alert.employee_id);
                                            setSelectedEmployeeCompanyId(alert.company_id);
                                            setShowTimelineModal(true);
                                          }}
                                          className="px-2 py-1 border border-brand-medium text-brand-medium hover:bg-blue-50 rounded-lg text-[10px] font-bold"
                                        >
                                          History
                                        </button>
                                        <button
                                          onClick={() => {
                                            setLockTarget({ id: alert.employee_id, email: alert.email, lock: true });
                                            setShowLockModal(true);
                                          }}
                                          className="p-1.5 bg-status-critical text-white hover:bg-red-700 rounded-lg transition-all"
                                          title="Lock user"
                                        >
                                          <Lock className="w-4 h-4" />
                                        </button>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-[10px] text-status-success font-bold flex items-center gap-1 bg-green-50/50 px-2 py-1 rounded border border-green-200">
                                    <Check className="w-3.5 h-3.5" /> Acknowledged
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <EmptyStateAlerts />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* World Map Login Heatmap (Super Admin only) */}
              {admin?.role === 'superadmin' && (
                <WorldMap token={token} />
              )}

              {/* Action Board (Company Management / Lock Controls) */}
              {admin?.role === 'superadmin' ? (
                <div className="bg-white rounded-xl shadow p-6 border border-brand-light">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xs font-semibold uppercase text-slate tracking-wider">Onboarded Client Tenants</h3>
                    <button
                      onClick={() => setShowOnboardModal(true)}
                      className="px-3 py-1.5 bg-brand-dark text-white rounded-lg text-xs font-bold hover:bg-brand-medium flex items-center gap-1 transition-all"
                    >
                      <Plus className="w-4 h-4" /> Onboard Company
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-brand-light text-brand-dark uppercase tracking-wider font-semibold">
                          <th className="p-3 rounded-l-lg">Company ID</th>
                          <th className="p-3">Company Name</th>
                          <th className="p-3">Workspace Domain</th>
                          <th className="p-3">Webhook Callback</th>
                          <th className="p-3 rounded-r-lg text-right">Actions</th>
                        </tr>
                      </thead>
                    </table>
                      <div className="text-center py-8 text-xs text-slate">
                        Go to the <button onClick={() => setActiveTab('companies')} className="text-brand-medium font-bold underline">Companies Tab</button> to manage rosters and view API credentials.
                      </div>
                    </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow p-6 border border-brand-light">
                  <h3 className="text-xs font-semibold uppercase text-slate tracking-wider mb-4">Security Incident Quick Actions</h3>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <button
                      onClick={() => {
                        const email = prompt('Enter employee email to force-lock:');
                        if (email) lockMutation.mutate({ employeeId: '1', lock: true }); // Demo uses employee serial 1
                      }}
                      className="px-4 py-2 bg-status-critical text-white font-bold rounded-lg hover:bg-red-700 transition-all flex items-center gap-1"
                    >
                      <Lock className="w-4 h-4" /> Lock Employee Account
                    </button>
                    <button
                      onClick={() => {
                        const email = prompt('Enter employee email to manual-unlock:');
                        if (email) lockMutation.mutate({ employeeId: '1', lock: false });
                      }}
                      className="px-4 py-2 border border-brand-dark text-brand-dark font-bold rounded-lg hover:bg-brand-light transition-all flex items-center gap-1"
                    >
                      <Unlock className="w-4 h-4" /> Unlock Employee Account
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Companies view (Super Admin only) */}
          {displayTab === 'companies' && admin?.role === 'superadmin' && (
            <div className="space-y-6">
              <div className="card-warden p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-base font-bold font-display text-charcoal">Tenant Management Panel</h2>
                    <p className="text-xs text-slate">Onboard clients, review details, and synchronize employee lists.</p>
                  </div>
                  <button
                    onClick={() => setShowOnboardModal(true)}
                    className="px-3.5 py-2 bg-[#0A4D8C] hover:bg-[#0D6EB8] text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                  >
                    <Plus className="w-4 h-4" /> Onboard Company
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-brand-light text-brand-dark uppercase tracking-wider font-semibold">
                        <th className="p-3.5 rounded-l-xl">Company ID</th>
                        <th className="p-3.5">Company Name</th>
                        <th className="p-3.5">Workspace Domain</th>
                        <th className="p-3.5">Webhook Callback</th>
                        <th className="p-3.5 rounded-r-xl text-right">Roster Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-light">
                      {companiesData?.companies && companiesData.companies.length > 0 ? (
                        companiesData.companies.map((company) => (
                          <tr key={company.id} className="hover:bg-brand-bg transition-colors">
                            <td className="p-3.5 font-bold text-charcoal">{company.id}</td>
                            <td className="p-3.5 font-medium">{company.name}</td>
                            <td className="p-3.5 font-medium">{company.domain}</td>
                            <td className="p-3.5 text-slate font-mono text-[10px]">{company.callback_url}</td>
                            <td className="p-3.5 text-right">
                              <button
                                onClick={() => {
                                  setSelectedCompanyId(company.id);
                                  setEmployeeRosterInput(
                                    JSON.stringify(
                                      [{ external_employee_id: 1, email: `employee@${company.domain}` }],
                                      null,
                                      2
                                    )
                                  );
                                  setShowRosterModal(true);
                                }}
                                className="px-3 py-1.5 bg-[#1A7FBF] text-white text-[10px] font-bold rounded-lg hover:bg-[#0A4D8C] transition-colors"
                              >
                                Sync Roster
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" className="text-center py-8 text-slate font-semibold">No companies registered on platform.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Alerts Feed view */}
          {displayTab === 'alerts' && (
            <div className="space-y-6">
              <div className="card-warden p-6">
                
                {/* Search Bar */}
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
                  <div>
                    <h2 className="text-base font-bold font-display text-charcoal">Real-Time Threat Center</h2>
                    <p className="text-xs text-slate">Live streaming security exceptions across verified nodes.</p>
                  </div>
                  <div className="relative w-full md:w-72">
                    <Search className="absolute left-3 top-3 w-4 h-4 text-slate" />
                    <input
                      type="text"
                      placeholder="Search alerts (e.g. Russia, Lockout)..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-xs text-charcoal focus:outline-none focus:border-[#0A4D8C] focus:ring-3 focus:ring-[#0A4D8C]/12 transition-all"
                    />
                  </div>
                </div>

                {/* Alerts List */}
                <div className="space-y-4">
                  {alerts.length > 0 ? (
                    alerts
                      .filter(a => searchQuery === '' || a.reason.toLowerCase().includes(searchQuery.toLowerCase()))
                      .map((alert) => {
                        const isAck = alert.status === 'acknowledged';
                        const isCrit = alert.severity === 'critical';
                        const color = isAck ? '#2E9E6B' : (isCrit ? '#D93025' : alert.severity === 'high' ? '#F5A623' : '#1A7FBF');

                        return (
                          <div
                            key={alert.id}
                            style={{
                              opacity: isAck ? '0.6' : '1',
                              background: (!isAck && isCrit) ? 'linear-gradient(90deg, rgba(217,48,37,0.04) 0%, transparent 120px)' : '#FFFFFF'
                            }}
                            className="group p-4 border border-[#E8F4FD] rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all duration-300 relative pl-6 hover:shadow-[0_2px_8px_rgba(10,77,140,0.05)] alert-row-appear"
                          >
                            {/* Left Accent Color bar */}
                            <div 
                              className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition-colors duration-300"
                              style={{ backgroundColor: color }}
                            />

                            {/* Info panel */}
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                  isCrit ? 'badge-glass-critical' :
                                  alert.severity === 'high' ? 'badge-glass-warning' :
                                  alert.severity === 'medium' ? 'badge-glass-medium' : 'badge-glass-low'
                                }`}>
                                  {alert.severity}
                                </span>
                                <span className="text-[10px] text-[#6B7FA3] font-semibold font-mono">
                                  {formatDistanceToNow(new Date(alert.created_at || alert.timestamp))} ago
                                </span>
                                {admin?.role === 'superadmin' && (
                                  <span className="text-[10px] bg-brand-light text-brand-dark px-1.5 py-0.5 rounded font-semibold">
                                    Tenant: {alert.company_name || alert.company_id}
                                  </span>
                                )}
                                {alert.risk_score !== undefined && (
                                  <div className="relative group inline-block cursor-help z-20">
                                    <span className="text-[10px] font-bold bg-[#E8F4FD] text-[#0A4D8C] px-1.5 py-0.5 rounded hover:bg-[#0A4D8C] hover:text-white transition-colors">
                                      Risk: {alert.risk_score || 0}
                                    </span>
                                    <div className="absolute left-0 bottom-full mb-2 w-64 hidden group-hover:block bg-slate-900 text-white rounded-lg shadow-xl p-3 z-30 text-[10px] space-y-1.5 border border-slate-700 pointer-events-none">
                                      <p className="font-bold border-b border-slate-700 pb-1 uppercase tracking-wider text-brand-medium">Rule Score Breakdown</p>
                                      {alert.score_breakdown_json ? (
                                        Object.entries(
                                          typeof alert.score_breakdown_json === 'string'
                                            ? JSON.parse(alert.score_breakdown_json)
                                            : alert.score_breakdown_json
                                        ).map(([rule, val]) => (
                                          (val.score > 0 || val.details?.includes('Anomaly')) && (
                                            <div key={rule} className="flex justify-between font-mono">
                                              <span className="capitalize">{rule.replace('_', ' ')}:</span>
                                              <span className="font-bold text-amber-400">+{val.score}</span>
                                            </div>
                                          )
                                        ))
                                      ) : (
                                        <div className="flex justify-between font-mono">
                                          <span>Roster mismatch anomaly:</span>
                                          <span className="font-bold text-amber-400">+100</span>
                                        </div>
                                      )}
                                      <div className="flex justify-between font-bold border-t border-slate-700 pt-1.5 text-amber-400 mt-1">
                                        <span>Total risk score:</span>
                                        <span>{alert.risk_score || 0} / 100</span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <h4 className="text-sm font-bold text-charcoal">{alert.reason}</h4>
                              <p className="text-xs text-slate">
                                Employee: <span className="font-semibold text-brand-dark">{alert.email}</span> (ID: #{alert.employee_id || 'Anomaly'})
                              </p>
                            </div>

                            {/* Action panel */}
                            <div className="flex items-center gap-2 self-end md:self-center">
                              {!isAck ? (
                                <>
                                  <button
                                    onClick={() => ackMutation.mutate({ alertId: alert.id, action: 'acknowledged' })}
                                    className="px-2.5 py-1 border border-brand-dark text-brand-dark hover:bg-brand-light rounded-lg text-xs font-semibold flex items-center gap-1"
                                  >
                                    <Check className="w-3.5 h-3.5" /> Acknowledge
                                  </button>
                                  
                                  {alert.employee_id && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setSelectedEmployeeId(alert.employee_id);
                                          setSelectedEmployeeCompanyId(alert.company_id);
                                          setShowTimelineModal(true);
                                        }}
                                        className="px-2.5 py-1 border border-brand-medium text-brand-medium hover:bg-brand-light rounded-lg text-xs font-semibold"
                                      >
                                        History
                                      </button>
                                      <button
                                        onClick={() => {
                                          setLockTarget({ id: alert.employee_id, email: alert.email, lock: true });
                                          setShowLockModal(true);
                                        }}
                                        className="px-2.5 py-1 bg-status-critical text-white rounded-lg text-xs font-bold hover:bg-red-700"
                                      >
                                        Lock User
                                      </button>
                                    </>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs text-status-success font-semibold flex items-center gap-1 bg-green-50 px-2 py-1 rounded-lg border border-green-200">
                                  <Check className="w-3.5 h-3.5" /> Acknowledged
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                  ) : (
                    <EmptyStateAlerts />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Audit Logs view */}
          {displayTab === 'logs' && (
            <div className="card-warden p-6">
              <div className="mb-6">
                <h2 className="text-base font-bold font-display text-charcoal">Immutable Audit Ledger</h2>
                <p className="text-xs text-slate">Chronological ledger of security administrative tasks. Protected against deletes.</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-brand-light text-brand-dark uppercase tracking-wider font-semibold">
                      <th className="p-3.5 rounded-l-xl">Timestamp (UTC)</th>
                      <th className="p-3.5">Admin Email</th>
                      <th className="p-3.5">Action Executed</th>
                      <th className="p-3.5">Target Node</th>
                      <th className="p-3.5 rounded-r-xl">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-light">
                    {auditData?.auditLogs && auditData.auditLogs.length > 0 ? (
                      auditData.auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-brand-bg transition-colors">
                          <td className="p-3.5 font-mono text-[10px] text-slate">
                            {format(new Date(log.created_at), 'yyyy-MM-dd HH:mm:ss')}
                          </td>
                          <td className="p-3.5 font-bold text-charcoal">{log.admin_email || 'System Operation'}</td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-brand-light text-brand-dark uppercase font-semibold">
                              {log.action}
                            </span>
                          </td>
                          <td className="p-3.5 text-slate font-bold">{log.target_type}: #{log.target_id}</td>
                          <td className="p-3.5 font-mono text-[10px] text-slate max-w-xs truncate">
                            {JSON.stringify(log.metadata_json)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="text-center py-8 text-slate font-semibold">No audit records generated.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Settings View (Super Admin only) */}
          {displayTab === 'settings' && admin?.role === 'superadmin' && (
            <RiskSettingsView token={token} />
          )}

          {/* Locked Accounts View */}
          {displayTab === 'locked' && (
            <LockedEmployeesView token={token} role={admin?.role} companies={companiesData?.companies} />
          )}

          {/* Employees Directory View */}
          {displayTab === 'employees' && (
            <EmployeesDirectoryView 
              token={token} 
              role={admin?.role} 
              companies={companiesData?.companies} 
              onOpenTimeline={(employeeId, companyId) => {
                setSelectedEmployeeId(employeeId);
                setSelectedEmployeeCompanyId(companyId);
                setShowTimelineModal(true);
              }}
            />
          )}
          </div>
        </main>
      </div>

      {/* =========================================================================
          MODALS & OVERLAYS
          ========================================================================= */}
      
      {/* Onboard Company Modal */}
      {showOnboardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 animate-slideIn">
            <h3 className="text-lg font-bold font-display text-charcoal mb-4 border-b border-brand-light pb-2">Onboard New Client Portal</h3>
            
            {!onboardedDetails ? (
              <form onSubmit={handleOnboardSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-charcoal uppercase tracking-wider mb-1">Company Tenant ID</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. acme_corp"
                      value={companyIdInput}
                      onChange={(e) => setCompanyIdInput(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-charcoal uppercase tracking-wider mb-1">Display Name</label>
                    <input
                      type="text"
                      required
                      placeholder="Acme Corp"
                      value={companyNameInput}
                      onChange={(e) => setCompanyNameInput(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-charcoal uppercase tracking-wider mb-1">Authorized Domain</label>
                  <input
                    type="text"
                    required
                    placeholder="acme.com"
                    value={companyDomainInput}
                    onChange={(e) => setCompanyDomainInput(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-charcoal uppercase tracking-wider mb-1">Callback URL (Client Auth Server)</label>
                  <input
                    type="text"
                    required
                    placeholder="http://localhost:4001/api/v1/auth/callback"
                    value={companyCallbackInput}
                    onChange={(e) => setCompanyCallbackInput(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-mono text-[10px]"
                  />
                </div>

                <div className="flex gap-2 justify-end border-t border-brand-light pt-4">
                  <button
                    type="button"
                    onClick={() => setShowOnboardModal(false)}
                    className="px-3 py-2 border rounded text-xs text-charcoal"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-2 bg-brand-dark hover:bg-brand-medium text-white font-bold rounded text-xs flex items-center gap-1"
                  >
                    Generate Credentials
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded p-4 text-xs space-y-2">
                  <p className="font-bold text-status-success">Tenant Onboarded Successfully!</p>
                  <p className="text-[10px] text-slate">Copy the API Ingestion Credentials below. They will not be shown again.</p>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <label className="font-bold text-charcoal">Tenant Client API Key:</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="text"
                        readOnly
                        value={onboardedDetails.apiKey}
                        className="flex-1 bg-brand-light px-3 py-1.5 rounded font-mono text-[10px] text-brand-dark focus:outline-none"
                      />
                      <button
                        onClick={() => handleCopyText(onboardedDetails.apiKey)}
                        className="px-2 bg-brand-light rounded border hover:bg-white"
                      >
                        <Copy className="w-4 h-4 text-brand-dark" />
                      </button>
                    </div>
                  </div>

                  <div className="border border-brand-light rounded p-3 space-y-1">
                    <span className="font-bold block text-charcoal">Default Admin Account Generated:</span>
                    <p className="text-[10px]">Email: <span className="font-mono text-brand-medium">{onboardedDetails.defaultAdmin.email}</span></p>
                    <p className="text-[10px]">Password: <span className="font-mono text-brand-medium">{onboardedDetails.defaultAdmin.password}</span></p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowOnboardModal(false);
                    setOnboardedDetails(null);
                  }}
                  className="w-full py-2 bg-brand-dark text-white text-xs font-bold rounded"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sync Roster Modal */}
      {showRosterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 animate-slideIn">
            <h3 className="text-lg font-bold font-display text-charcoal mb-2 pb-2 border-b border-brand-light">Sync Employee Roster: {selectedCompanyId}</h3>
            <p className="text-xs text-slate mb-4">Input the verified employee records in JSON format to update the whitelist.</p>
            
            <form onSubmit={handleRosterSubmit} className="space-y-4">
              <textarea
                value={employeeRosterInput}
                onChange={(e) => setEmployeeRosterInput(e.target.value)}
                className="w-full h-40 p-3 border border-gray-300 rounded font-mono text-[10px] text-charcoal focus:outline-none focus:border-brand-dark"
              />
              
              <div className="flex gap-2 justify-end border-t border-brand-light pt-4">
                <button
                  type="button"
                  onClick={() => setShowRosterModal(false)}
                  className="px-3 py-2 border rounded text-xs text-charcoal"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 bg-brand-dark text-white font-bold rounded text-xs"
                >
                  Submit Roster
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Lock/Unlock confirmation modal */}
      {showLockModal && lockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071F3C]/45 backdrop-blur-[4px] p-4 transition-all duration-300">
          <div className="bg-white rounded-2xl shadow-2xl w-[440px] p-8 modal-card-enter text-center space-y-5 relative">
            <div className="w-10 h-10 bg-amber-100 text-status-warning rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-5 h-5" />
            </div>
            
            <div className="space-y-2">
              <h3 className="font-display font-semibold text-lg text-charcoal">Confirm Administrative Override</h3>
              <p className="text-sm text-slate leading-relaxed">
                Are you sure you want to manually <strong>{lockTarget.lock ? 'lock' : 'unlock'}</strong> employee account: <span className="font-semibold text-brand-dark">{lockTarget.email}</span>?
              </p>
              <p className="text-xs text-slate/80 leading-normal">
                This triggers a secure callback event to the client backend to enforce session invalidation.
              </p>
            </div>

            <div className="flex gap-4 justify-center pt-2">
              <button
                onClick={() => setShowLockModal(false)}
                className="flex-1 py-2.5 border border-charcoal/20 rounded-lg text-sm text-charcoal hover:bg-slate-50 transition-all font-medium"
              >
                Cancel
              </button>
              <button
                disabled={!confirmEnabled}
                onClick={() => lockMutation.mutate({ employeeId: lockTarget.id, lock: lockTarget.lock })}
                style={{
                  transition: 'all 200ms ease-in-out',
                }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold text-white transition-all ${
                  confirmEnabled 
                    ? 'bg-status-critical hover:bg-red-700 active:scale-98 cursor-pointer' 
                    : 'bg-status-critical/50 opacity-50 cursor-not-allowed'
                }`}
              >
                {confirmEnabled ? 'Confirm' : 'Wait...'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline Modal */}
      {showTimelineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 animate-slideIn">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-brand-light">
              <h3 className="text-base font-bold font-display text-charcoal">Login History Timeline: ID #{selectedEmployeeId}</h3>
              <button onClick={() => { setShowTimelineModal(false); setSelectedEmployeeId(''); setSelectedEmployeeCompanyId(''); }} className="text-slate hover:text-charcoal">✕</button>
            </div>

            {timelineLoading ? (
              <div className="text-center py-12 text-xs text-slate"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /> Loading history...</div>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-4">
                <p className="text-xs font-semibold text-brand-dark">Employee Email: {timelineData?.email}</p>
                
                {timelineData?.timeline && timelineData.timeline.length > 0 && (() => {
                  const latestEvent = timelineData.timeline[0];
                  return (
                    <div className="bg-white rounded-2xl border border-[#E8F4FD] shadow-[0_1px_3px_rgba(10,77,140,0.06),0_4px_16px_rgba(10,77,140,0.04)] p-5 mb-6">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                        {/* 7-Day Risk Timeline */}
                        <div className="md:col-span-2 space-y-2">
                          <h4 className="text-xs font-bold text-slate uppercase tracking-wider">7-Day Risk Score History</h4>
                          <div className="h-44">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={[...timelineData.timeline].reverse().map(e => ({
                                time: format(new Date(e.timestamp), 'MM-dd HH:mm'),
                                score: e.risk_score || 0
                              }))}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(10,77,140,0.04)" />
                                <XAxis dataKey="time" tick={{ fontSize: 8, fill: '#6B7FA3' }} />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#6B7FA3' }} />
                                <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} />
                                <Line 
                                  type="monotone" 
                                  dataKey="score" 
                                  name="Risk Score" 
                                  stroke="#1A7FBF" 
                                  strokeWidth={2}
                                  dot={(props) => {
                                    const { cx, cy, payload } = props;
                                    const isSpike = payload.score >= 60;
                                    return (
                                      <circle 
                                        key={cx + '-' + cy} 
                                        cx={cx} 
                                        cy={cy} 
                                        r={isSpike ? 5.5 : 3.5} 
                                        fill={isSpike ? '#D93025' : '#1A7FBF'} 
                                        stroke="#FFF" 
                                        strokeWidth={1.5}
                                      />
                                    );
                                  }}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        {/* Circular Risk Score Gauge */}
                        <div className="md:col-span-1 flex flex-col items-center justify-center p-3 border-l border-[#E8F4FD]">
                          <h4 className="text-xs font-bold text-slate uppercase tracking-wider mb-3 text-center">Latest Event Risk</h4>
                          <RiskCircularGauge score={latestEvent.risk_score || 0} />
                        </div>
                      </div>

                      {/* Stacked Proportional Breakdown */}
                      <div className="mt-4">
                        <RiskScoreBreakdown breakdown={latestEvent.score_breakdown_json} />
                      </div>
                    </div>
                  );
                })()}
                
                {timelineData?.timeline && timelineData.timeline.length > 0 ? (
                  <div className="relative border-l border-brand-medium ml-3 space-y-6">
                    {timelineData.timeline.map((event) => (
                      <div key={event.id} className="relative pl-6">
                        {/* Dot badge */}
                        <span className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border border-white ${
                          event.event_type === 'success' && event.risk_score <= 30 ? 'bg-status-success' :
                          event.event_type === 'success' ? 'bg-status-warning' : 'bg-status-critical'
                        }`}></span>

                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate">{format(new Date(event.timestamp), 'yyyy-MM-dd HH:mm:ss')}</span>
                            <span className={`text-[9px] font-bold uppercase px-1 rounded ${
                              event.event_type === 'success' ? 'bg-green-100 text-status-success' : 'bg-red-100 text-status-critical'
                            }`}>{event.event_type}</span>
                            <span className="text-[10px] font-semibold text-charcoal">Risk Score: {event.risk_score || 0}</span>
                          </div>
                          <p className="text-xs text-slate">IP: {event.ip_address} ({event.city}, {event.country})</p>
                          <div className="mt-1 max-w-md">
                            <RiskScoreBreakdown breakdown={event.score_breakdown_json} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-xs text-slate">No login records found for this employee.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global Toast component */}
      <Toaster position="top-right" />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MainApp />
    </QueryClientProvider>
  );
}
