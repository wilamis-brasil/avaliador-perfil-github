const CONFIG = {
    apiBase: "https://api.github.com",
    maxReposToAnalyze: 100,
    featuredReposLimit: 12,
    cacheMaxEntries: 250,
    cacheTtlMs: 2 * 60 * 1000,
    requestTimeoutMs: 15000,
    
    weights: {
        profile: 350,
        contributions: 300,
        activity: 250,
        community: 100
    },

    categoryOrder: ['profile', 'contributions', 'activity', 'community'],

    labels: {
        profile: "Perfil",
        contributions: "Contrib.",
        activity: "Ativid.",
        community: "Comun."
    }
};

const STATE = {
    tokens: [],
    currentTokenIndex: 0,
    username: null,
    audit: null,
    cache: new Map(),
    history: []
};

const Utils = {
    setText(el, text) {
        if (el) el.textContent = text;
    },

    escapeHtml(value) {
        const s = String(value ?? '');
        return s
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    },

    normalizeHttpUrl(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;
        if (s.startsWith('http://') || s.startsWith('https://')) return s;
        return `https://${s}`;
    },

    uniqueBy(items, keyFn) {
        const out = [];
        const seen = new Set();
        for (const item of items) {
            const k = keyFn(item);
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(item);
        }
        return out;
    },

    decodeBase64Utf8(base64) {
        try {
            const cleaned = String(base64 || '').replaceAll('\n', '').replaceAll('\r', '');
            const binary = atob(cleaned);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        } catch (e) {
            console.error("Failed to decode base64", e);
            return "";
        }
    },

    sanitizeUsername(raw) {
        const value = String(raw || '').trim();
        if (!value || value.length > 39) return null;
        if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(value)) return null;
        return value;
    },

    async copyToClipboard(text) {
        const value = String(text || '');
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(value);
            return true;
        }
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', 'true');
        area.style.position = 'fixed';
        area.style.top = '-9999px';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
    },

    Storage: {
        loadHistory() {
            try {
                const raw = localStorage.getItem('gitAuditHistory');
                const parsed = raw ? JSON.parse(raw) : [];
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        },
        saveHistoryEntry(entry) {
            const history = this.loadHistory();
            const without = history.filter(e => e && e.username !== entry.username);
            const next = [entry, ...without].slice(0, 20);
            localStorage.setItem('gitAuditHistory', JSON.stringify(next));
            return next;
        }
    }
};

const GitHubAPI = {
    getHeaders() {
        const h = {
            'Accept': 'application/vnd.github+json,application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
        const currentToken = STATE.tokens[STATE.currentTokenIndex];
        if (currentToken) h['Authorization'] = `token ${currentToken}`;
        return h;
    },

    rotateToken() {
        if (STATE.currentTokenIndex < STATE.tokens.length - 1) {
            STATE.currentTokenIndex++;
            console.warn(`[API] Rotating to Token #${STATE.currentTokenIndex + 1}`);
            return true;
        }
        return false;
    },

    async fetch(endpoint) {
        const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.apiBase}${endpoint}`;
        
        const cached = STATE.cache.get(url);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
            
            const resp = await fetch(url, { 
                headers: this.getHeaders(), 
                signal: controller.signal 
            }).finally(() => clearTimeout(timeout));
            
            if (resp.status === 401) throw new Error("Token Inválido/Expirado.");
            
            if (resp.status === 403) {
                const remaining = Number(resp.headers.get('x-ratelimit-remaining'));
                const reset = Number(resp.headers.get('x-ratelimit-reset'));
                
                if (!Number.isNaN(remaining) && remaining === 0 && !Number.isNaN(reset)) {
                    const resetAt = new Date(reset * 1000);
                    throw new Error(`Limite de API excedido. Tente novamente após ${resetAt.toLocaleString()}.`);
                }
                
                if (this.rotateToken()) return await this.fetch(endpoint);
                throw new Error("Requisição bloqueada pela API (rate limit/abuse). Use um token válido e tente novamente.");
            }
            
            if (resp.status === 404) return null;
            if (!resp.ok) throw new Error(`Erro API ${resp.status}`);
            
            const data = await resp.json();
            
            STATE.cache.set(url, { value: data, expiresAt: Date.now() + CONFIG.cacheTtlMs });
            if (STATE.cache.size > CONFIG.cacheMaxEntries) {
                const oldestKey = STATE.cache.keys().next().value;
                STATE.cache.delete(oldestKey);
            }
            
            return data;
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error("Timeout ao consultar a API do GitHub.");
            }
            console.warn(`Fetch error: ${url}`, err);
            throw err;
        }
    },

    async fetchUserRepos(username, maxRepos) {
        const repos = [];
        for (let page = 1; repos.length < maxRepos; page++) {
            const batch = await this.fetch(`/users/${username}/repos?per_page=100&page=${page}&sort=pushed&direction=desc&type=owner`);
            if (!Array.isArray(batch) || batch.length === 0) break;
            repos.push(...batch);
            if (batch.length < 100) break;
        }
        return repos.slice(0, maxRepos);
    },

    async fetchUserEvents(username) {
        const pages = await Promise.all([
            this.fetch(`/users/${username}/events?per_page=100&page=1`).catch(() => []),
            this.fetch(`/users/${username}/events?per_page=100&page=2`).catch(() => []),
            this.fetch(`/users/${username}/events?per_page=100&page=3`).catch(() => [])
        ]);
        return pages.flat();
    }
};

const AuditEngine = {
    checks: [],
    redFlags: [],
    
    reset() {
        this.checks = [];
        this.redFlags = [];
    },

    addCheck(category, label, pass, weight, tip, impact = "medium", isBonus = false) {
        this.checks.push({ category, label, pass, weight, tip, impact, isBonus });
    },

    addRedFlag(message) {
        this.redFlags.push(message);
    },

    runAll(user, repos, events, contribsData, hasProfileReadme) {
        this.reset();
        this.auditProfile(user, hasProfileReadme);
        this.auditContributions(contribsData);
        this.auditActivity(repos, user);
        this.auditCommunity(events, user);
        return this.calculateFinalScore();
    },

    auditProfile(user, hasProfileReadme) {
        const cat = 'profile';
        const accountAge = new Date().getFullYear() - new Date(user.created_at).getFullYear();

        this.addCheck(cat, "Avatar Profissional", !!user.avatar_url, 20, "Use uma foto clara, profissional e amigável.");
        this.addCheck(cat, "Nome Real", user.name && user.name !== user.login, 20, "Nome real gera mais confiança que nicknames.");
        this.addCheck(cat, "Bio Estratégica", user.bio && user.bio.length > 20, 30, "Descreva sua stack, foco atual e valor profissional.");
        this.addCheck(cat, "Localização", !!user.location, 10, "Crucial para filtros de recrutamento e fuso horário.");
        this.addCheck(cat, "Email Público", !!user.email, 25, "Facilite o contato direto de recrutadores/partners.");
        this.addCheck(cat, "Portfolio/Link", !!user.blog, 15, "Link para LinkedIn, Portfolio ou Blog pessoal.");
        
        this.addCheck(cat, "Status Hireable", !!user.hireable, 10, "Indique explicitamente que está aberto a oportunidades.", "medium", true);
        this.addCheck(cat, "Empresa/Org", !!user.company, 5, "Mostra afiliação profissional ou educacional atual.", "low", true);
        this.addCheck(cat, "Profile README", hasProfileReadme, 40, "Crie um repo com seu username para personalizar seu perfil.", "high", true);
        this.addCheck(cat, "Twitter/Social", !!user.twitter_username, 5, "Conecte redes sociais para prova social.", "low", true);
        
        if (user.followers > 500) {
            this.addCheck(cat, "Influência (Top Voice)", true, 100, "Você é uma referência na comunidade!", "high", true);
        } else if (user.followers > 100) {
            this.addCheck(cat, "Influência (Rising Star)", true, 40, "Você tem um público crescente.", "medium", true);
        }

        if (accountAge >= 3) {
            this.addCheck(cat, "Conta Veterana", true, 30, "Sua longevidade no GitHub mostra compromisso.", "high", true);
        }
        
        if (!user.bio && !user.company && !user.blog) {
            this.addRedFlag("Perfil 'Fantasma': Falta de informações básicas afasta oportunidades.");
        }
    },

    auditContributions(contribsData) {
        const cat = 'contributions';
        const total = contribsData?.totalContributions;

        if (typeof total === 'number') {
            this.addCheck(cat, "Contribuições no Ano (>=200)", total >= 200, 40, "Aumente consistência: pequenas contribuições frequentes contam.", "high");
            this.addCheck(cat, "Contribuições no Ano (>=600)", total >= 600, 20, "Boa cadência; mantenha o ritmo.", "medium", true);
        } else {
            this.addCheck(cat, "Contribuições no Ano (Disponível)", false, 40, "Não consegui obter suas contribuições anuais agora (API externa indisponível).", "high");
        }
    },

    auditActivity(repos, user) {
        const cat = 'activity';
        const repoList = repos || [];

        const pushedDates = repoList
            .map(r => r?.pushed_at ? new Date(r.pushed_at) : null)
            .filter(d => d && !Number.isNaN(d.getTime()));
        
        const lastPush = pushedDates.length ? new Date(Math.max(...pushedDates)) : null;
        const daysSincePush = lastPush ? (new Date() - lastPush) / (1000 * 3600 * 24) : 999;

        const active90 = repoList.filter(r => {
            const pushed = r?.pushed_at ? new Date(r.pushed_at) : null;
            if (!pushed || Number.isNaN(pushed.getTime())) return false;
            return (new Date() - pushed) / (1000 * 3600 * 24) <= 90;
        }).length;

        const years = Math.max(1, new Date().getFullYear() - new Date(user.created_at).getFullYear());
        const reposPerYear = (Number(user.public_repos) || 0) / years;

        this.addCheck(cat, "Último Push (<=30 dias)", daysSincePush <= 30, 35, "Mantenha um projeto principal sempre em evolução.", "high");
        this.addCheck(cat, "Repos Ativos (90 dias) (>=2)", active90 >= 2, 35, "Evite manter só um projeto ativo; mantenha 2+ em evolução.", "high");
        this.addCheck(cat, "Cadência de Projetos (repos/ano >=2)", reposPerYear >= 2, 20, "Crie projetos menores e públicos para mostrar evolução contínua.", "medium");

        const languages = new Set(repoList.map(r => r?.language).filter(Boolean)).size;
        this.addCheck(cat, "Diversidade de Linguagens (>=2)", languages >= 2, 10, "Mostre amplitude (ou foco claro) em stack.", "low", true);
    },

    auditCommunity(events, user) {
        const cat = 'community';
        const login = String(user?.login || '').toLowerCase();

        const externalCount = events.filter(e => {
            const repoName = e?.repo?.name || '';
            const owner = repoName.split('/')[0]?.toLowerCase();
            return owner && owner !== login;
        }).length;

        this.addCheck(cat, "Contribuições Externas", externalCount > 0, 35, "Contribua em projetos de outras pessoas (issues/PRs).", "high");

        const prEvents = events.filter(e => e?.type === 'PullRequestEvent').length;
        const issueEvents = events.filter(e => e?.type === 'IssuesEvent').length;
        this.addCheck(cat, "Atuação em PRs/Issues", prEvents + issueEvents >= 2, 25, "Participe de PRs e issues; isso mostra colaboração real.", "high");

        const followers = Number(user?.followers) || 0;
        this.addCheck(cat, "Prova Social (>=20 seguidores)", followers >= 20, 15, "Construa networking e contribua de forma visível.", "low", true);
    },

    calculateFinalScore() {
        const categoryScores = {};
        
        this.checks.forEach(c => {
            if (!categoryScores[c.category]) {
                categoryScores[c.category] = { total: 0, max: 0, checks: [] };
            }
            if (!c.isBonus) categoryScores[c.category].max += c.weight;
            if (c.pass) categoryScores[c.category].total += c.weight;
            categoryScores[c.category].checks.push(c);
        });

        const finalCategories = {};
        let weightedSum = 0;
        let totalWeight = 0;

        Object.keys(categoryScores).forEach(cat => {
            const s = categoryScores[cat];
            const rawPct = s.max > 0 ? (s.total / s.max) * 100 : 0;
            const cappedPct = Math.min(100, rawPct);
            
            finalCategories[cat] = Math.round(cappedPct);
            const w = CONFIG.weights[cat] || 0;
            weightedSum += cappedPct * w;
            totalWeight += w;
        });

        let globalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
        globalScore -= (this.redFlags.length * 5);
        if (globalScore < 0) globalScore = 0;

        return {
            categories: finalCategories,
            global: globalScore,
            checks: this.checks,
            redFlags: this.redFlags
        };
    }
};

const Metrics = {
    getTopLanguages(repos, max = 3) {
        const freq = new Map();
        (repos || []).forEach(r => {
            if (r?.language) freq.set(r.language, (freq.get(r.language) || 0) + 1);
        });
        return [...freq.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, max)
            .map(([lang]) => lang);
    },

    computeProfileMetrics(audit) {
        const { user, allRepos, events, contribsData } = audit;
        const years = Math.max(1, new Date().getFullYear() - new Date(user.created_at).getFullYear());
        
        const pushedDates = (allRepos || [])
            .map(r => r?.pushed_at ? new Date(r.pushed_at) : null)
            .filter(d => d && !Number.isNaN(d.getTime()));
        const lastPush = pushedDates.length ? new Date(Math.max(...pushedDates)) : null;
        const daysSincePush = lastPush ? (new Date() - lastPush) / (1000 * 3600 * 24) : 999;

        return {
            years,
            daysSincePush,
            contribTotal: contribsData?.totalContributions || 0,
            active90: (allRepos || []).filter(r => {
                const pushed = r?.pushed_at ? new Date(r.pushed_at) : null;
                return pushed && (new Date() - pushed) / (1000 * 3600 * 24) <= 90;
            }).length
        };
    },

    computeMarketSignal(audit) {
        const { user, results, allRepos } = audit;
        const metrics = this.computeProfileMetrics(audit);
        const nonForks = (allRepos || []).filter(r => !r.fork);
        const topLangs = this.getTopLanguages(nonForks);

        const contactOk = !!(user?.email || user?.blog || user?.twitter_username);
        const clarityOk = !!(user?.name && user?.bio && String(user.bio).trim().length >= 25);
        const proofOk = metrics.daysSincePush <= 30 || metrics.contribTotal >= 100 || metrics.active90 >= 1;

        const okCount = [contactOk, clarityOk, proofOk].filter(Boolean).length;
        const verdict = okCount === 3 ? "PRONTO" : okCount === 2 ? "QUASE" : "AJUSTAR";

        let summary = "Falta sinal claro para triagem rápida.";
        if (!contactOk) summary = "Recrutador pode travar: faltou um canal de contato.";
        else if (!clarityOk) summary = "Recrutador pode não entender você: bio/nome pouco claros.";
        else if (!proofOk) summary = "Prova pública fraca: pouca atividade recente/consistência.";
        else if (results.global >= 85) summary = "Triagem rápida: passa com folga (perfil bem completo).";
        else summary = "Triagem rápida: passa, mas com pontos para melhorar.";

        return {
            verdict,
            summary,
            stack: topLangs.length ? topLangs.join(" · ") : "—",
            sigContact: contactOk ? "OK" : "FALTA",
            sigClarity: clarityOk ? "OK" : "AJUSTAR",
            sigProof: proofOk ? "OK" : "BAIXO"
        };
    }
};

const UI = {
    elements: {},

    init() {
        this.elements = {
            searchView: document.getElementById('search-view'),
            loaderView: document.getElementById('loader-view'),
            dashboardView: document.getElementById('dashboard-view'),
            
            inputs: {
                user: document.getElementById('username'),
                token: document.getElementById('token'),
                btn: document.getElementById('btn-analyze')
            },
            
            loader: {
                text: document.getElementById('loader-text'),
                sub: document.getElementById('loader-sub')
            },
            
            profile: {
                avatar: document.getElementById('p-avatar'),
                name: document.getElementById('p-name'),
                login: document.getElementById('p-login'),
                bio: document.getElementById('p-bio'),
                company: document.getElementById('p-company'),
                location: document.getElementById('p-location'),
                site: document.getElementById('p-site'),
                email: document.getElementById('p-email'),
                followers: document.getElementById('p-followers')
            },
            
            report: {
                gradeCircle: document.getElementById('final-grade-circle'),
                score: document.getElementById('final-score'),
                subscores: document.getElementById('subscores-container'),
                redFlagsSection: document.getElementById('red-flags-section'),
                redFlagsList: document.getElementById('red-flags-list'),
                actionsList: document.getElementById('top-actions-list'),
                checklist: document.getElementById('checklist-container'),
                repos: document.getElementById('repos-container'),
                statRepos: document.getElementById('stat-repos-count'),
                statYears: document.getElementById('stat-years'),
                statContribs: document.getElementById('stat-contribs'),
                gSummary: document.getElementById('g-summary'),
                gStack: document.getElementById('g-stack'),
                gSigContact: document.getElementById('g-sig-contact'),
                gSigClarity: document.getElementById('g-sig-clarity'),
                gSigProof: document.getElementById('g-sig-proof'),
                history: document.getElementById('history-container'),
                btnShare: document.getElementById('btn-share'),
                recruiterFeedback: document.getElementById('recruiter-feedback-text')
            },

            btnBack: document.getElementById('btn-back')
        };

        if (this.elements.btnBack) {
            this.elements.btnBack.onclick = () => this.showSearchView();
        }
    },

    showLoader(text) {
        Utils.setText(this.elements.loader.text, text);
        this.elements.searchView?.classList.add('hidden');
        this.elements.dashboardView?.classList.add('hidden');
        this.elements.loaderView?.classList.remove('hidden');
    },

    showDashboard() {
        this.elements.loaderView?.classList.add('hidden');
        this.elements.searchView?.classList.add('hidden');
        this.elements.dashboardView?.classList.remove('hidden');
    },

    showSearchView() {
        this.elements.dashboardView?.classList.add('hidden');
        this.elements.loaderView?.classList.add('hidden');
        this.elements.searchView?.classList.remove('hidden');
        if (this.elements.inputs.user) this.elements.inputs.user.value = '';
        STATE.audit = null;
    },

    renderDashboard(audit) {
        const { user, results, featuredRepos, contribsData } = audit;
        const el = this.elements;

        if (el.profile.avatar) el.profile.avatar.src = user.avatar_url;
        this.renderProfileName(user);
        Utils.setText(el.profile.login, user.login);
        Utils.setText(el.profile.bio, user.bio || "Sem bio definida");
        Utils.setText(el.profile.company, user.company || "-");
        Utils.setText(el.profile.location, user.location || "-");
        Utils.setText(el.profile.email, user.email || "-");
        Utils.setText(el.profile.followers, user.followers);
        this.renderWebsiteLink(user.blog);

        Utils.setText(el.report.score, `${results.global}/100`);
        const grade = results.global >= 90 ? 'A' : results.global >= 80 ? 'B' : results.global >= 60 ? 'C' : results.global >= 40 ? 'D' : 'F';
        Utils.setText(el.report.gradeCircle, grade);
        if (el.report.gradeCircle) el.report.gradeCircle.className = `ScoreCircle ${grade}`;
        this.renderSubscores(results.categories);

        this.renderRedFlags(results.redFlags);
        this.renderActionPlan(results.checks);
        this.renderFullChecklist(results.checks);

        this.renderFeaturedRepos(featuredRepos);

        this.renderStats(user, contribsData);
        this.renderMarketSignals(audit);
        this.renderRecruiterFeedback(results);

        this.showDashboard();
    },

    renderProfileName(user) {
        const nameEl = this.elements.profile.name;
        if (!nameEl) return;
        nameEl.textContent = user.name || user.login;
        
        if (user.followers > 100) {
            const isFamous = user.followers > 500;
            const badge = document.createElement('span');
            badge.className = `ProfileBadge ${isFamous ? 'ProfileBadge--famous' : 'ProfileBadge--rising'}`;
            badge.textContent = isFamous ? 'FAMOUS' : 'RISING';
            nameEl.appendChild(badge);
        }
    },

    renderWebsiteLink(blog) {
        const siteEl = this.elements.profile.site;
        if (!siteEl) return;
        const url = Utils.normalizeHttpUrl(blog);
        siteEl.innerHTML = '';
        if (!url) {
            siteEl.textContent = '-';
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noreferrer noopener';
            a.textContent = 'Website';
            siteEl.appendChild(a);
        }
    },

    renderSubscores(categories) {
        const container = this.elements.report.subscores;
        if (!container) return;
        const order = ['profile', 'contributions', 'activity', 'community'].filter(cat => cat in categories);
        container.innerHTML = order.map(cat => `
            <div class="SubscoreItem">
                <span class="SubscoreLabel">${CONFIG.labels[cat] || cat}</span>
                <div class="SubscoreTrack">
                    <div class="SubscoreFill" style="width: ${categories[cat]}%"></div>
                </div>
                <span class="SubscoreValue">${categories[cat]}%</span>
            </div>
        `).join('');
    },

    renderRedFlags(redFlags) {
        const section = this.elements.report.redFlagsSection;
        const list = this.elements.report.redFlagsList;
        if (!section || !list) return;

        if (redFlags.length > 0) {
            section.classList.remove('hidden');
            list.innerHTML = redFlags.map(f => `<li>${Utils.escapeHtml(f)}</li>`).join('');
        } else {
            section.classList.add('hidden');
        }
    },

    renderActionPlan(checks) {
        const list = this.elements.report.actionsList;
        if (!list) return;

        const failures = checks
            .filter(c => !c.pass && !c.isBonus)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 6);

        if (failures.length === 0) {
            list.innerHTML = `<div class="ActionItem text-center"><p class="width-full">Perfil Impecável! 🚀</p></div>`;
            return;
        }

        list.innerHTML = failures.map((f, i) => `
            <div class="ActionItem">
                <div class="ActionIndex">${i + 1}</div>
                <div class="flex-column width-full">
                    <div class="ActionHeaderRow">
                        <h4 class="text-bold text-small ActionTitleText">${Utils.escapeHtml(f.label)}</h4>
                        <span class="TagPill">${(CONFIG.labels[f.category] || f.category).toUpperCase()}</span>
                    </div>
                    <p class="text-small text-muted mb-0">${Utils.escapeHtml(f.tip)}</p>
                </div>
            </div>
        `).join('');
    },

    renderFullChecklist(checks) {
        const container = this.elements.report.checklist;
        if (!container) return;

        container.innerHTML = checks.map(c => `
            <div class="AuditItem">
                <i class='bx ${c.pass ? 'bx-check-circle pass' : 'bx-x-circle fail'} AuditIcon'></i>
                <div class="AuditContent">
                    <div class="d-flex justify-between items-center">
                        <span class="AuditTitle">${Utils.escapeHtml(c.label)} ${c.isBonus ? '<span class="BonusBadge">BÔNUS</span>' : ''}</span>
                        <span class="AuditScore">${c.pass ? `+${c.weight}` : '0'}</span>
                    </div>
                    <p class="AuditDesc">${Utils.escapeHtml(c.tip)}</p>
                </div>
            </div>
        `).join('');
    },

    renderFeaturedRepos(repos) {
        const container = this.elements.report.repos;
        if (!container) return;

        container.innerHTML = (repos || []).map(repo => `
            <div class="RepoCard">
                <div class="RepoCard-header">
                    <a href="${repo.html_url}" target="_blank" class="RepoCard-name" rel="noreferrer noopener">${Utils.escapeHtml(repo.name)}</a>
                    <span class="RepoCard-grade">${repo.language || 'N/A'}</span>
                </div>
                <div class="RepoCard-desc">${Utils.escapeHtml(repo.description || "Sem descrição.")}</div>
                <div class="d-flex gap-3 text-small text-muted">
                    <span><i class='bx bx-star'></i> ${repo.stargazers_count}</span>
                    <span><i class='bx bx-git-repo-forked'></i> ${repo.forks_count}</span>
                    <span><i class='bx bx-error-circle'></i> ${repo.open_issues_count}</span>
                </div>
            </div>
        `).join('');
    },

    renderStats(user, contribsData) {
        const el = this.elements.report;
        const years = Math.max(1, new Date().getFullYear() - new Date(user.created_at).getFullYear());
        const repoCount = user.public_repos;
        const ratio = repoCount / years;

        const createBadge = (label, variant) => {
            const colors = {
                success: { bg: '#dafbe1', fg: '#1a7f37' },
                info: { bg: '#ddf4ff', fg: '#0969da' },
                danger: { bg: '#ffebe9', fg: '#cf222e' },
                pioneer: { bg: '#24292f', fg: '#fff', border: '#24292f' }
            };
            const c = colors[variant] || { bg: 'transparent', fg: '#24292f', border: '#d0d7de' };
            const style = `font-size:10px; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:8px; background:${c.bg}; color:${c.fg}; ${c.border ? `border: 1px solid ${c.border};` : ''}`;
            return `<span style="${style}">${label}</span>`;
        };

        if (el.statRepos) {
            let badge = ratio < 2 ? createBadge("BAIXO", "danger") : ratio > 8 ? createBadge("ALTO", "success") : createBadge("SAUDÁVEL", "info");
            el.statRepos.innerHTML = `${repoCount}${badge}`;
            el.statRepos.parentElement.title = `Média de ${ratio.toFixed(1)} repositórios/ano.`;
        }

        if (el.statContribs) {
            const total = contribsData?.totalContributions ?? "N/A";
            let badge = "";
            if (typeof total === 'number') {
                badge = total > 1000 ? createBadge("INTENSO", "success") : total > 300 ? createBadge("ATIVO", "info") : createBadge("BAIXO", "danger");
            }
            el.statContribs.innerHTML = `${total}${badge}`;
        }

        if (el.statYears) {
            let variant = years < 1 ? "danger" : years <= 3 ? "success" : years <= 7 ? "info" : "pioneer";
            let label = years < 1 ? "NOVO" : years <= 3 ? "BOM" : years <= 7 ? "SÓLIDO" : "PIONEIRO";
            el.statYears.innerHTML = `${years}${createBadge(label, variant)}`;
            el.statYears.parentElement.title = `Conta criada em ${new Date(user.created_at).getFullYear()}.`;
        }
    },

    renderMarketSignals(audit) {
        const g = Metrics.computeMarketSignal(audit);
        const el = this.elements.report;

        if (el.gSummary) el.gSummary.innerHTML = `<strong>${g.verdict}</strong> — ${g.summary}`;
        if (el.gStack) el.gStack.textContent = g.stack || 'Nenhuma stack detectada';

        const setSig = (element, val) => {
            if (!element) return;
            element.textContent = val;
            element.className = 'MarketSignalVal';
            if (['OK', 'PRONTO'].includes(val)) element.classList.add('ok');
            else if (['WARN', 'AJUSTAR', 'BAIXO', 'QUASE'].includes(val)) element.classList.add('warn');
            else element.classList.add('bad');
        };

        setSig(el.gSigContact, g.sigContact);
        setSig(el.gSigClarity, g.sigClarity);
        setSig(el.gSigProof, g.sigProof);
    },

    renderRecruiterFeedback(results) {
        const el = this.elements.report.recruiterFeedback;
        if (!el) return;

        let feedback = "";
        const { global: score, categories } = results;
        
        if (score >= 90) feedback = "Este perfil passa muita confiança. Bio clara, presença consistente e sinais de colaboração pública facilitam muito minha triagem. Eu entraria em contato para entrevista técnica.";
        else if (score >= 70) feedback = "O perfil é sólido e tem bons indicativos. Para elevar o nível, faltam alguns detalhes de apresentação e mais consistência de atividade pública. É um candidato forte, mas pode melhorar a vitrine.";
        else if (score >= 50) feedback = "Vejo potencial, mas o perfil parece incompleto ou com sinais fracos de consistência. Falta contexto e prova de trabalho recente/colaborativo. Eu recomendaria reforçar a presença pública para aumentar as chances de contato.";
        else feedback = "O perfil precisa de atenção urgente. Faltam informações básicas e sinais de atividade/contribuição recente. Para recrutamento, fica difícil avaliar com segurança. Parece uma conta pouco ativa.";
        
        if (categories.profile < 50) feedback += " <br><br><strong>Dica:</strong> Melhore sua Bio e foto para causar uma primeira impressão melhor.";
        else if (categories.contributions < 50) feedback += " <br><br><strong>Dica:</strong> Aumente consistência de contribuições públicas para evidenciar experiência.";
        
        el.innerHTML = feedback;
    },

    renderHistory(history) {
        const container = this.elements.report.history;
        if (!container) return;

        if (!history || history.length === 0) {
            container.innerHTML = `
                <div class="HistoryItem">
                    <div class="HistoryLeft">
                        <div class="HistoryUser">Sem histórico</div>
                        <div class="HistoryMeta">Suas auditorias recentes aparecem aqui.</div>
                    </div>
                </div>`;
            return;
        }

        container.innerHTML = history.map(e => `
            <div class="HistoryItem">
                <div class="HistoryLeft">
                    <div class="HistoryUser">@${Utils.escapeHtml(e.username)}</div>
                    <div class="HistoryMeta">${new Date(e.ts).toLocaleString()} · ${e.score}/100</div>
                </div>
                <button class="btn btn-secondary HistoryBtn" data-reaudit="${Utils.escapeHtml(e.username)}">Reanalisar</button>
            </div>
        `).join('');

        container.querySelectorAll('[data-reaudit]').forEach(btn => {
            btn.onclick = () => {
                if (this.elements.inputs.user) this.elements.inputs.user.value = btn.dataset.reaudit;
                startAudit();
            };
        });
    }
};

const startAudit = async () => {
    const username = Utils.sanitizeUsername(UI.elements.inputs.user?.value);
    if (!username) return alert("Digite um username válido.");

    const rawToken = UI.elements.inputs.token?.value.trim() || "";
    STATE.tokens = rawToken ? rawToken.split(',').map(t => t.trim()).filter(t => t) : [];
    STATE.currentTokenIndex = 0;
    STATE.cache.clear();

    UI.showLoader("Analisando Perfil e Contribuições...");
    
    try {
        const [user, contribsData, profileReadmeResp, repos] = await Promise.all([
            GitHubAPI.fetch(`/users/${username}`),
            fetch(`https://github-contributions-api.deno.dev/${username}.json`).then(r => r.json()).catch(() => null),
            fetch(`${CONFIG.apiBase}/repos/${username}/${username}`, { headers: GitHubAPI.getHeaders() }),
            GitHubAPI.fetchUserRepos(username, CONFIG.maxReposToAnalyze).catch(() => [])
        ]);

        if (!user) throw new Error("Usuário não encontrado.");
        
        UI.showLoader("Analisando Impacto na Comunidade...");
        const events = await GitHubAPI.fetchUserEvents(username);
        
        const hasProfileReadme = profileReadmeResp.status === 200;
        const allRepos = repos || [];
        const nonForkRepos = allRepos.filter(r => !r.fork);
        
        const auditResults = AuditEngine.runAll(user, nonForkRepos, events, contribsData, hasProfileReadme);
        
        const featuredRepos = [...nonForkRepos]
            .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
            .slice(0, CONFIG.featuredReposLimit);

        STATE.audit = { user, results: auditResults, events, featuredRepos, contribsData, allRepos };
        UI.renderDashboard(STATE.audit);
        
        const history = Utils.Storage.saveHistoryEntry({
            username: user.login,
            score: auditResults.global,
            ts: Date.now()
        });
        UI.renderHistory(history);

        if (STATE.tokens.length === 1) {
            const trials = parseInt(localStorage.getItem('gitAuditTrials') || '0');
            localStorage.setItem('gitAuditTrials', (trials + 1).toString());
        }

    } catch (err) {
        console.error(err);
        UI.showSearchView();
        alert(`Erro na auditoria: ${err.message}`);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    UI.init();

    UI.elements.inputs.btn?.addEventListener('click', startAudit);
    UI.elements.inputs.user?.addEventListener('keypress', e => {
        if (e.key === 'Enter') startAudit();
    });

    const btnShare = UI.elements.report.btnShare;
    if (btnShare) {
        btnShare.addEventListener('click', async (e) => {
            e.preventDefault();
            const u = STATE.audit?.user?.login;
            if (!u) return;
            const url = new URL(window.location.href);
            url.searchParams.set('u', u);
            
            try {
                const ok = await Utils.copyToClipboard(url.toString());
                if (ok) {
                    const original = btnShare.innerHTML;
                    btnShare.innerHTML = "<i class='bx bx-check'></i> Copiado!";
                    setTimeout(() => btnShare.innerHTML = original, 2000);
                }
            } catch {
                alert("Não foi possível copiar automaticamente.");
            }
        });
    }

    document.querySelectorAll('.TabNav-item').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.TabNav-item').forEach(t => t.classList.remove('selected'));
            document.querySelectorAll('.TabContent').forEach(c => c.classList.remove('active'));
            tab.classList.add('selected');
            const panel = document.getElementById(tab.dataset.tab);
            if (panel) panel.classList.add('active');
        });
    });

    const params = new URLSearchParams(window.location.search);
    const u = Utils.sanitizeUsername(params.get('u'));
    if (u && UI.elements.inputs.user) {
        UI.elements.inputs.user.value = u;
        setTimeout(startAudit, 100);
    }

    UI.renderHistory(Utils.Storage.loadHistory());
});
