'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Search, Mic, FileText, Target, Award } from 'lucide-react';
import styles from './Header.module.css';

import { useSession } from 'next-auth/react';

interface HeaderProps {
    title: string;
    subtitle?: string;
}

// ── Search: lazily-fetched, client-side substring match over the user's
// own interviews + resume analyses. No new backend needed — reuses the
// same endpoints the History and Resume pages already call. ──
interface SearchResult {
    id: string;
    label: string;
    sublabel: string;
    href: string;
}

interface ActivityItem {
    type: string;
    title: string;
    subtitle: string;
    score: number;
    time: string;
}

const activityIcon: Record<string, React.ElementType> = {
    interview: Mic,
    resume: FileText,
    goal: Target,
    streak: Award,
};

const LAST_SEEN_KEY = 'mockview-activity-last-seen';

export default function Header({ title, subtitle }: HeaderProps) {
    const { data: session } = useSession();

    // ── Search state ──
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchIndex, setSearchIndex] = useState<SearchResult[] | null>(null);
    const searchRef = useRef<HTMLDivElement>(null);

    // ── Notifications state ──
    const [notifOpen, setNotifOpen] = useState(false);
    const [activity, setActivity] = useState<ActivityItem[] | null>(null);
    const [hasUnread, setHasUnread] = useState(false);
    const notifRef = useRef<HTMLDivElement>(null);

    // Compute initials from actual user name
    const userName = session?.user?.name || 'User';
    const initials = userName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    // ── Close either dropdown on outside click ──
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setSearchOpen(false);
            }
            if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
                setNotifOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // ── Lazily check for unread activity once, so the dot is accurate
    // without forcing every page load to fetch the dashboard. ──
    useEffect(() => {
        fetch('/api/dashboard')
            .then((res) => res.json())
            .then((data) => {
                const items: ActivityItem[] = data.recentActivity || [];
                if (items.length === 0) return;
                const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
                const newest = new Date(items[0].time).getTime();
                setHasUnread(!lastSeen || newest > Number(lastSeen));
            })
            .catch(() => { /* non-critical, leave the dot as-is */ });
    }, []);

    const openSearch = () => {
        setSearchOpen((v) => !v);
        setNotifOpen(false);
        if (!searchIndex) {
            Promise.all([
                fetch('/api/interviews').then((r) => r.json()),
                fetch('/api/resume').then((r) => r.json()),
            ])
                .then(([interviewsData, resumeData]) => {
                    const interviewResults: SearchResult[] = (interviewsData.interviews || []).map(
                        (i: { id: string; type: string; topic: string }) => ({
                            id: `interview-${i.id}`,
                            label: i.topic,
                            sublabel: `${i.type.charAt(0).toUpperCase() + i.type.slice(1)} interview`,
                            href: `/history/${i.id}`,
                        })
                    );
                    const resumeResults: SearchResult[] = (resumeData.analyses || []).map(
                        (a: { id: string; fileName: string; targetRole: string }) => ({
                            id: `resume-${a.id}`,
                            label: a.fileName,
                            sublabel: `Resume analysis · ${a.targetRole || 'General'}`,
                            href: '/resume',
                        })
                    );
                    setSearchIndex([...interviewResults, ...resumeResults]);
                })
                .catch(() => setSearchIndex([]));
        }
    };

    const openNotifications = () => {
        setNotifOpen((v) => !v);
        setSearchOpen(false);
        if (!activity) {
            fetch('/api/dashboard')
                .then((res) => res.json())
                .then((data) => setActivity(data.recentActivity || []))
                .catch(() => setActivity([]));
        }
        // Mark as read
        setHasUnread(false);
        localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    };

    const filteredResults = (searchIndex || []).filter((r) => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return true;
        return r.label.toLowerCase().includes(q) || r.sublabel.toLowerCase().includes(q);
    }).slice(0, 8);

    return (
        <header className={styles.header}>
            <div className={styles.left}>
                <h1 className={styles.title}>{title}</h1>
                {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
            </div>
            <div className={styles.right}>
                <div className={styles.dropdownWrap} ref={searchRef}>
                    <button className={styles.iconBtn} aria-label="Search" onClick={openSearch}>
                        <Search size={18} />
                    </button>
                    <AnimatePresence>
                        {searchOpen && (
                            <motion.div
                                className={styles.searchPanel}
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.15 }}
                            >
                                <input
                                    autoFocus
                                    type="text"
                                    className={styles.searchInput}
                                    placeholder="Search interviews & resumes..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                                <div className={styles.searchResults}>
                                    {!searchIndex ? (
                                        <p className={styles.dropdownEmpty}>Loading...</p>
                                    ) : filteredResults.length === 0 ? (
                                        <p className={styles.dropdownEmpty}>
                                            {searchIndex.length === 0 ? 'Nothing to search yet.' : 'No matches.'}
                                        </p>
                                    ) : (
                                        filteredResults.map((r) => (
                                            <a key={r.id} href={r.href} className={styles.searchResultItem}>
                                                <span className={styles.searchResultLabel}>{r.label}</span>
                                                <span className={styles.searchResultSub}>{r.sublabel}</span>
                                            </a>
                                        ))
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className={styles.dropdownWrap} ref={notifRef}>
                    <button className={styles.iconBtn} aria-label="Notifications" onClick={openNotifications}>
                        <Bell size={18} />
                        {hasUnread && <span className={styles.notifDot} />}
                    </button>
                    <AnimatePresence>
                        {notifOpen && (
                            <motion.div
                                className={styles.notifPanel}
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.15 }}
                            >
                                <p className={styles.dropdownHeading}>Recent Activity</p>
                                {!activity ? (
                                    <p className={styles.dropdownEmpty}>Loading...</p>
                                ) : activity.length === 0 ? (
                                    <p className={styles.dropdownEmpty}>No activity yet — go practice!</p>
                                ) : (
                                    activity.map((item, i) => {
                                        const Icon = activityIcon[item.type] || Bell;
                                        return (
                                            <div key={i} className={styles.notifItem}>
                                                <div className={styles.notifIcon}>
                                                    <Icon size={14} />
                                                </div>
                                                <div>
                                                    <p className={styles.notifTitle}>{item.title}</p>
                                                    <p className={styles.notifSub}>
                                                        {item.subtitle} · Score {item.score}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className={styles.avatar}>
                    <span>{initials}</span>
                </div>
            </div>
        </header>
    );
}
