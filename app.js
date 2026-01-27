// GitAuditor Premium Plus - Core Logic
// v4.3 - Definitive Edition (Bonus Logic & Safe UI)

/* =========================================
   CONFIG & WEIGHTS
   ========================================= */
const CONFIG = {
    apiBase: "https://api.github.com",
    maxReposToAnalyze: 50,
    deepScanLimit: 10,
    
    weights: {
        profile: 150,    // 15%
        repository: 300, // 30%
        community: 200,  // 20%
        security: 150,   // 15%
        activity: 200    // 20%
    },

    penalties: {
        missingLicense: -50,
        missingReadme: -100,
        exposedSecrets: -200,
        staleProfile: -30
    }
};

const STATE = {
    tokens: [],
    currentTokenIndex: 0,
    username: null,
    audit: null,
    cache: new Map()
};

/* =========================================
   UI HELPERS
   ========================================= */
const ui = {
    searchView: null, loaderView: null, dashboardView: null,
    inputs: { user: null, token: null, btn: null },
    loader: { text: null, sub: null },
    profile: {},
    report: {},
};

// Safe Text Setter (Prevents Null Crash)
const setText = (el, text) => {
    if (el) el.textContent = text;
};

const initDOM = () => {
    ui.searchView = document.getElementById('search-view');
    ui.loaderView = document.getElementById('loader-view');
    ui.dashboardView = document.getElementById('dashboard-view');
    
    ui.inputs.user = document.getElementById('username');
    ui.inputs.token = document.getElementById('token');
    ui.inputs.btn = document.getElementById('btn-analyze');
    
    ui.loader.text = document.getElementById('loader-text');
    ui.loader.sub = document.getElementById('loader-sub');
    
    ['avatar', 'name', 'login', 'bio', 'company', 'location', 'site', 'email', 'followers'].forEach(id => {
        ui.profile[id] = document.getElementById(`p-${id}`);
    });

    ui.report = {
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
        heatmap: document.getElementById('heatmap-container')
    };
    
    const btnBack = document.getElementById('btn-back');
    if (btnBack) {
        btnBack.onclick = () => {
            if(ui.dashboardView) ui.dashboardView.classList.add('hidden');
            if(ui.searchView) ui.searchView.classList.remove('hidden');
            if(ui.inputs.user) ui.inputs.user.value = '';
            STATE.audit = null;
        };
    }
};

/* =========================================
   API LAYER
   ========================================= */
const getHeaders = () => {
    const h = { 'Accept': 'application/vnd.github.v3+json' };
    const currentToken = STATE.tokens[STATE.currentTokenIndex];
    if (currentToken) h['Authorization'] = `token ${currentToken}`;
    return h;
};

const rotateToken = () => {
    if (STATE.currentTokenIndex < STATE.tokens.length - 1) {
        STATE.currentTokenIndex++;
        console.warn(`[API] Rotating to Token #${STATE.currentTokenIndex + 1}`);
        return true;
    }
    return false;
};

const fetchAPI = async (endpoint) => {
    const url = endpoint.startsWith('http') ? endpoint : `${CONFIG.apiBase}${endpoint}`;
    if (STATE.cache.has(url)) return STATE.cache.get(url);

    try {
        const resp = await fetch(url, { headers: getHeaders() });
        
        if (resp.status === 401) throw new Error("Token Inválido/Expirado.");
        if (resp.status === 403) {
            if (rotateToken()) return await fetchAPI(endpoint);
            throw new Error("Limite de API excedido. Use um token válido.");
        }
        if (resp.status === 404) return null;
        if (!resp.ok) throw new Error(`Erro API ${resp.status}`);
        
        const data = await resp.json();
        STATE.cache.set(url, data);
        return data;
    } catch (err) {
        console.warn(`Fetch error: ${url}`, err);
        throw err;
    }
};

/* =========================================
   AUDIT ENGINE (PREMIUM)
   ========================================= */
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

    auditProfile(user, specialRepo) {
        const c = 'profile';
        // Core (High Weight for Basics)
        this.addCheck(c, "Avatar Profissional", !!user.avatar_url, 20, "Use uma foto clara, profissional e amigável.");
        this.addCheck(c, "Nome Real", user.name && user.name !== user.login, 20, "Nome real gera mais confiança que nicknames.");
        this.addCheck(c, "Bio Estratégica", user.bio && user.bio.length > 20, 30, "Descreva sua stack, foco atual e valor profissional.");
        this.addCheck(c, "Localização", !!user.location, 10, "Crucial para filtros de recrutamento e fuso horário.");
        this.addCheck(c, "Email Público", !!user.email, 25, "Facilite o contato direto de recrutadores/partners.");
        this.addCheck(c, "Portfolio/Link", !!user.blog, 15, "Link para LinkedIn, Portfolio ou Blog pessoal.");
        
        // Bonus
        this.addCheck(c, "Status Hireable", !!user.hireable, 10, "Indique explicitamente que está aberto a oportunidades.", "medium", true);
        this.addCheck(c, "Empresa/Org", !!user.company, 5, "Mostra afiliação profissional ou educacional atual.", "low", true);
        this.addCheck(c, "Profile README", !!specialRepo, 40, "Crie um repo com seu username para personalizar seu perfil.", "high", true);
        this.addCheck(c, "Twitter/Social", !!user.twitter_username, 5, "Conecte redes sociais para prova social.", "low", true);
        
        // Influence Bonus (Famosinho Check)
        if (user.followers > 500) {
            this.addCheck(c, "Influência (Top Voice)", true, 50, "Você é uma referência na comunidade!", "high", true);
        } else if (user.followers > 100) {
            this.addCheck(c, "Influência (Rising Star)", true, 20, "Você tem um público crescente.", "medium", true);
        }
        
        if (!user.bio && !user.company && !user.blog) {
            this.addRedFlag("Perfil 'Fantasma': Falta de informações básicas afasta oportunidades.");
        }
    },

    auditRepository(repo, files, readme, commits, workflows) {
        const c = 'repository';
        const fileNames = files.map(f => f.name.toUpperCase());
        const prefix = `[${repo.name}]`;
        
        // Core
        this.addCheck(c, `${prefix} Descrição`, !!repo.description, 10, `Adicione uma descrição curta e objetiva.`);
        this.addCheck(c, `${prefix} Homepage`, !!repo.homepage, 5, "Link para demo ou documentação.", "medium", true); // Bonus
        this.addCheck(c, `${prefix} Tópicos`, repo.topics && repo.topics.length > 0, 10, "Use tags para categorizar.", "low", true); // Bonus
        
        const hasReadme = fileNames.includes('README.MD');
        this.addCheck(c, `${prefix} README`, hasReadme, 20, "Obrigatório para qualquer projeto sério.");
        if (hasReadme) {
            const content = readme ? atob(readme.content) : "";
            this.addCheck(c, `${prefix} README Rico`, content.length > 800, 10, "README muito curto.");
            this.addCheck(c, `${prefix} Badges`, /!\[.*\]\(.*badge.*\)/.test(content), 5, "Use badges para credibilidade.", "low", true); // Bonus
        } else if (repo.stargazers_count > 5) {
            this.addRedFlag(`Repo "${repo.name}" tem stars mas não tem README.`);
        }

        this.addCheck(c, `${prefix} .gitignore`, fileNames.includes('.GITIGNORE'), 10, "Evite commitar arquivos de sistema.");
        const hasWorkflows = workflows && workflows.total_count > 0;
        this.addCheck(c, `${prefix} CI/CD`, hasWorkflows, 25, "Automatize testes e deploy.", "high", true); // Bonus
        const hasTests = fileNames.some(f => /TEST|SPEC/i.test(f));
        this.addCheck(c, `${prefix} Testes`, hasTests || hasWorkflows, 15, "Código sem testes é dívida técnica.", "high", true); // Bonus
    },

    auditCommunity(repo, files) {
        const c = 'community';
        const fileNames = files.map(f => f.name.toUpperCase());
        const prefix = `[${repo.name}]`;
        
        this.addCheck(c, `${prefix} Licença`, !!repo.license, 20, "Sem licença, ninguém pode usar legalmente.");
        
        // Bonus
        this.addCheck(c, `${prefix} CONTRIBUTING`, fileNames.includes('CONTRIBUTING.MD'), 15, "Guia para colaboradores.", "medium", true);
        this.addCheck(c, `${prefix} Code of Conduct`, fileNames.includes('CODE_OF_CONDUCT.MD'), 10, "Padrões de comunidade.", "low", true);
        
        const hasIssueTemplate = fileNames.includes('ISSUE_TEMPLATE') || fileNames.includes('.GITHUB');
        this.addCheck(c, `${prefix} Issue Templates`, hasIssueTemplate, 10, "Padronize reports.", "low", true);
        this.addCheck(c, `${prefix} PR Template`, fileNames.includes('PULL_REQUEST_TEMPLATE.MD') || fileNames.includes('.GITHUB'), 10, "Qualidade nos PRs.", "low", true);
        this.addCheck(c, `${prefix} Discussions`, repo.has_discussions, 5, "Fórum da comunidade.", "low", true);
    },

    auditSecurity(repo, files, commits) {
        const c = 'security';
        const fileNames = files.map(f => f.name.toUpperCase());
        const prefix = `[${repo.name}]`;
        
        this.addCheck(c, `${prefix} SECURITY.md`, fileNames.includes('SECURITY.MD'), 20, "Política de segurança.", "high", true); // Bonus
        
        if (commits && commits.length > 0) {
            const signedCommits = commits.filter(cm => cm.commit.verification && cm.commit.verification.verified);
            const signedRatio = signedCommits.length / commits.length;
            this.addCheck(c, `${prefix} GPG Signing`, signedRatio > 0.5, 20, "Assine commits (Verified).", "medium", true); // Bonus
        }
        
        this.addCheck(c, `${prefix} Branch Main`, repo.default_branch === 'main', 5, "Use 'main' como padrão.", "low", true); // Bonus
        if (/secret|key|token|pwd|credential/.test(repo.name)) {
            this.addRedFlag(`Repo "${repo.name}" tem nome suspeito.`);
        }
    },

    auditActivity(events, user) {
        const c = 'activity';
        const lastEvent = events.length ? new Date(events[0].created_at) : null;
        const daysSinceLast = lastEvent ? (new Date() - lastEvent) / (1000 * 3600 * 24) : 999;
        
        this.addCheck(c, "Atividade Recente", daysSinceLast < 14, 30, "Mantenha consistência. GitHub parado passa impressão de abandono.");
        this.addCheck(c, "Volume de Contribuição", events.length > 50, 20, "Demonstre volume de trabalho ativo.");
        
        const reposTouched = new Set(events.map(e => e.repo.name)).size;
        this.addCheck(c, "Diversidade de Projetos", reposTouched > 2, 15, "Não trabalhe apenas em um repositório.");
        
        const external = events.filter(e => !e.repo.name.startsWith(user.login)).length;
        this.addCheck(c, "Colaboração Externa", external > 0, 25, "Contribua em projetos que não são seus (Open Source real).", "high", true); // Bonus
    }
};

/* =========================================
   MAIN LOGIC FLOW
   ========================================= */
const startAudit = async () => {
    initDOM();
    AuditEngine.reset();
    
    const rawToken = ui.inputs.token ? ui.inputs.token.value.trim() : "";
    const trials = parseInt(localStorage.getItem('gitAuditTrials') || '0');
    
    const userTokens = rawToken ? rawToken.split(',').map(t => t.trim()).filter(t => t) : [];
    const fallbackToken = "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";
    STATE.tokens = [...userTokens, fallbackToken];
    STATE.currentTokenIndex = 0;
    STATE.cache.clear();

    const username = ui.inputs.user ? ui.inputs.user.value.trim() : "";
    if (!username) return alert("Digite um username válido.");
    
    if (STATE.tokens.length === 0 && trials >= 3) {
        alert("Limite gratuito atingido. Adicione um token.");
        return;
    }

    if(ui.searchView) ui.searchView.classList.add('hidden');
    if(ui.dashboardView) ui.dashboardView.classList.add('hidden');
    if(ui.loaderView) ui.loaderView.classList.remove('hidden');
    
    try {
        setText(ui.loader.text, "Analisando Perfil...");
        const user = await fetchAPI(`/users/${username}`);
        if(!user) throw new Error("Usuário não encontrado.");
        
        setText(ui.loader.text, "Escaneando Repositórios...");
        const repos = await fetchAPI(`/users/${username}/repos?per_page=${CONFIG.maxReposToAnalyze}&sort=updated&type=owner`);
        const sourceRepos = repos.filter(r => !r.fork);
        const specialRepo = repos.find(r => r.name.toLowerCase() === username.toLowerCase());
        
        AuditEngine.auditProfile(user, specialRepo);
        
        setText(ui.loader.text, "Auditoria Profunda de Engenharia...");
        const deepLimit = STATE.tokens.length > 0 ? CONFIG.deepScanLimit : 3;
        const candidates = sourceRepos.sort((a,b) => b.stargazers_count - a.stargazers_count).slice(0, deepLimit);
        
        const deepResults = await Promise.all(candidates.map(async (repo) => {
            const [contents, readme, commits, workflows] = await Promise.all([
                fetchAPI(`/repos/${username}/${repo.name}/contents`),
                fetchAPI(`/repos/${username}/${repo.name}/readme`).catch(()=>null),
                fetchAPI(`/repos/${username}/${repo.name}/commits?per_page=10`).catch(()=>[]),
                fetchAPI(`/repos/${username}/${repo.name}/actions/workflows`).catch(()=>null)
            ]);
            
            const fileList = Array.isArray(contents) ? contents : [];
            AuditEngine.auditRepository(repo, fileList, readme, commits, workflows);
            AuditEngine.auditCommunity(repo, fileList);
            AuditEngine.auditSecurity(repo, fileList, commits);
            return { repo };
        }));

        setText(ui.loader.text, "Analisando Impacto na Comunidade...");
        const [p1, p2, p3] = await Promise.all([
            fetchAPI(`/users/${username}/events?per_page=100&page=1`).catch(()=>[]),
            fetchAPI(`/users/${username}/events?per_page=100&page=2`).catch(()=>[]),
            fetchAPI(`/users/${username}/events?per_page=100&page=3`).catch(()=>[])
        ]);
        const events = [...p1, ...p2, ...p3];
        AuditEngine.auditActivity(events, user);
        
        const finalResults = calculateScores(AuditEngine.checks, AuditEngine.redFlags);
        STATE.audit = { user, results: finalResults, events, repos: sourceRepos, deepResults };
        renderDashboard();
        
        if (STATE.tokens.length === 1) {
             localStorage.setItem('gitAuditTrials', (trials + 1).toString());
        }

    } catch (err) {
        console.error(err);
        if(ui.loaderView) ui.loaderView.classList.add('hidden');
        if(ui.searchView) ui.searchView.classList.remove('hidden');
        alert(`Erro na auditoria: ${err.message}`);
    }
};

const calculateScores = (checks, redFlags) => {
    const scores = {
        profile: { total: 0, max: 0, checks: [] },
        repository: { total: 0, max: 0, checks: [] },
        community: { total: 0, max: 0, checks: [] },
        security: { total: 0, max: 0, checks: [] },
        activity: { total: 0, max: 0, checks: [] }
    };

    checks.forEach(c => {
        if (!scores[c.category]) return;
        
        // Bonus logic: Only add to max if NOT bonus (core requirement)
        if (!c.isBonus) {
            scores[c.category].max += c.weight;
        }
        
        // Always add to total if passed
        if (c.pass) {
            scores[c.category].total += c.weight;
        }
        
        scores[c.category].checks.push(c);
    });

    const finalScores = {};
    let weightedSum = 0;
    let totalWeight = 0;

    Object.keys(scores).forEach(cat => {
        const s = scores[cat];
        // Allow > 100% if bonus pushes it over, but cap later
        const rawPct = s.max > 0 ? (s.total / s.max) * 100 : 0;
        const cappedPct = Math.min(100, rawPct); // Cap individual category at 100%
        
        finalScores[cat] = Math.round(cappedPct);
        weightedSum += cappedPct * CONFIG.weights[cat];
        totalWeight += CONFIG.weights[cat];
    });

    let globalScore = Math.round(weightedSum / totalWeight);
    globalScore -= (redFlags.length * 5);
    if (globalScore < 0) globalScore = 0;

    return { categories: finalScores, global: globalScore, checks: checks, redFlags: redFlags };
};

const renderDashboard = () => {
    const { user, results, events, repos } = STATE.audit;
    
    if(ui.profile.avatar) ui.profile.avatar.src = user.avatar_url;
    
    // Name + Badge Logic
    let nameHTML = user.name || user.login;
    if (user.followers > 500) nameHTML += ' <span style="background:#f1e05a; color:#000; font-size:10px; padding:2px 6px; border-radius:10px; vertical-align:middle; border:1px solid rgba(0,0,0,0.1); margin-left:6px;">🌟 FAMOUS</span>';
    else if (user.followers > 100) nameHTML += ' <span style="background:#dbedff; color:#0366d6; font-size:10px; padding:2px 6px; border-radius:10px; vertical-align:middle; border:1px solid rgba(0,0,0,0.1); margin-left:6px;">🚀 RISING</span>';
    ui.profile.name.innerHTML = nameHTML;

    setText(ui.profile.login, user.login);
    setText(ui.profile.bio, user.bio || "Sem bio definida");
    setText(ui.profile.company, user.company || "-");
    setText(ui.profile.location, user.location || "-");
    setText(ui.profile.email, user.email || "-");
    setText(ui.profile.followers, user.followers);
    if(ui.profile.site) ui.profile.site.innerHTML = user.blog ? `<a href="${user.blog.startsWith('http') ? user.blog : 'https://'+user.blog}" target="_blank">Website</a>` : "-";

    setText(ui.report.score, `${results.global}/100`);
    const grade = results.global >= 90 ? 'A' : results.global >= 80 ? 'B' : results.global >= 60 ? 'C' : results.global >= 40 ? 'D' : 'F';
    setText(ui.report.gradeCircle, grade);
    if(ui.report.gradeCircle) ui.report.gradeCircle.className = `ScoreCircle ${grade}`;

    const labels = {
        profile: "Perfil & Marca",
        repository: "Engenharia",
        community: "Governança",
        security: "Segurança",
        activity: "Atividade"
    };
    
    if(ui.report.subscores) ui.report.subscores.innerHTML = Object.keys(results.categories).map(cat => `
        <div class="SubscoreItem">
            <span class="SubscoreLabel">${labels[cat]}</span>
            <div class="SubscoreTrack">
                <div class="SubscoreFill" style="width: ${results.categories[cat]}%"></div>
            </div>
            <span class="SubscoreValue">${results.categories[cat]}%</span>
        </div>
    `).join('');

    if (results.redFlags.length > 0) {
        if(ui.report.redFlagsSection) ui.report.redFlagsSection.classList.remove('hidden');
        if(ui.report.redFlagsList) ui.report.redFlagsList.innerHTML = results.redFlags.map(f => `<li>${f}</li>`).join('');
    } else {
        if(ui.report.redFlagsSection) ui.report.redFlagsSection.classList.add('hidden');
    }

    const failures = results.checks.filter(c => !c.pass && !c.isBonus).sort((a,b) => b.weight - a.weight);
    if(ui.report.actionsList) {
        if (failures.length === 0) {
            ui.report.actionsList.innerHTML = `<div class="ActionItem text-center"><p class="width-full">Perfil Impecável! 🚀</p></div>`;
        } else {
            ui.report.actionsList.innerHTML = failures.slice(0, 6).map((f, i) => `
                <div class="ActionItem">
                    <div class="ActionIndex">${i+1}</div>
                    <div class="flex-column width-full">
                        <div class="d-flex justify-between">
                            <h4 class="text-bold text-small">${f.label}</h4>
                            <span class="text-small text-muted" style="font-size:10px; border:1px solid #ddd; padding:2px 4px; border-radius:4px">${f.category.toUpperCase()}</span>
                        </div>
                        <p class="text-small text-muted mb-0">${f.tip}</p>
                    </div>
                </div>
            `).join('');
        }
    }

    if(ui.report.checklist) {
        ui.report.checklist.innerHTML = results.checks.map(c => `
            <div class="AuditItem">
                <i class='bx ${c.pass ? 'bx-check-circle pass' : 'bx-x-circle fail'} AuditIcon'></i>
                <div class="AuditContent">
                    <div class="d-flex justify-between items-center">
                        <span class="AuditTitle">${c.label} ${c.isBonus ? '<span style="font-size:10px; background:#def; padding:1px 4px; border-radius:4px; color:#0366d6; margin-left:6px;">BÔNUS</span>' : ''}</span>
                        <span class="AuditScore">${c.pass ? `+${c.weight}` : '0'}</span>
                    </div>
                    <p class="AuditDesc">${c.tip}</p>
                </div>
            </div>
        `).join('');
    }

    if(ui.report.repos) {
        ui.report.repos.innerHTML = STATE.audit.deepResults.map(r => `
            <div class="RepoCard">
                <div class="RepoCard-header">
                    <a href="${r.repo.html_url}" target="_blank" class="RepoCard-name">${r.repo.name}</a>
                    <span class="RepoCard-grade">${r.repo.language || 'N/A'}</span>
                </div>
                <div class="RepoCard-desc">${r.repo.description || "Sem descrição."}</div>
                <div class="d-flex gap-3 text-small text-muted">
                    <span><i class='bx bx-star'></i> ${r.repo.stargazers_count}</span>
                    <span><i class='bx bx-git-repo-forked'></i> ${r.repo.forks_count}</span>
                    <span><i class='bx bx-error-circle'></i> ${r.repo.open_issues_count}</span>
                </div>
            </div>
        `).join('');
    }
    
    // Stats with Context
    const years = Math.max(1, new Date().getFullYear() - new Date(user.created_at).getFullYear());
    const repoCount = repos.length;
    const ratio = repoCount / years;
    
    let volumeBadge = "";
    let volumeTitle = `Média de ${ratio.toFixed(1)} repositórios/ano.`;
    
    if (ratio < 2) {
        volumeBadge = `<span style="font-size:10px; background:#ffebe9; color:#cf222e; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:8px;">BAIXO</span>`;
        volumeTitle += " Considere criar mais projetos públicos.";
    } else if (ratio > 8) {
        volumeBadge = `<span style="font-size:10px; background:#dafbe1; color:#1a7f37; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:8px;">ALTO</span>`;
        volumeTitle += " Ótimo volume de produção!";
    } else {
        volumeBadge = `<span style="font-size:10px; background:#ddf4ff; color:#0969da; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:8px;">SAUDÁVEL</span>`;
        volumeTitle += " Volume consistente com a média.";
    }

    if (ui.report.statRepos) {
        ui.report.statRepos.innerHTML = `${repoCount}${volumeBadge}`;
        ui.report.statRepos.title = volumeTitle;
        ui.report.statRepos.parentElement.title = volumeTitle; // Tooltip on box too
        ui.report.statRepos.style.cursor = "help";
    }
    
    // Years Logic (Authority/Longevity)
    let seniorityBadge = "";
    let seniorityTitle = `Conta criada em ${new Date(user.created_at).getFullYear()}.`;

    if (years < 1) {
        seniorityBadge = `<span style="font-size:10px; background:#ffebe9; color:#cf222e; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:8px;">NOVO</span>`;
        seniorityTitle += " Conta recente (pouco histórico).";
    } else if (years <= 3) {
        seniorityBadge = `<span style="font-size:10px; background:#dafbe1; color:#1a7f37; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:8px;">ATIVO</span>`;
        seniorityTitle += " Histórico em construção.";
    } else if (years <= 7) {
        seniorityBadge = `<span style="font-size:10px; background:#ddf4ff; color:#0969da; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:8px;">SÓLIDO</span>`;
        seniorityTitle += " Perfil com boa longevidade.";
    } else {
        seniorityBadge = `<span style="font-size:10px; background:#f1e05a; color:#000; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:8px;">PIONEIRO</span>`;
        seniorityTitle += " Alta autoridade e histórico.";
    }

    if (ui.report.statYears) {
        ui.report.statYears.innerHTML = `${years}${seniorityBadge}`;
        ui.report.statYears.title = seniorityTitle;
        ui.report.statYears.parentElement.title = seniorityTitle;
        ui.report.statYears.style.cursor = "help";
    }

    // Recruiter Feedback
    const feedbackEl = document.getElementById('recruiter-feedback-text');
    if (feedbackEl) {
        let feedback = "";
        const score = results.global;
        const profileScore = results.categories.profile;
        const repoScore = results.categories.repository;
        
        if (score >= 90) {
            feedback = "Este perfil passa muita confiança técnica. A bio clara, foto profissional e repositórios bem documentados facilitam muito meu trabalho. Certamente entraria em contato para uma entrevista técnica, pois demonstra maturidade e cuidado com o código.";
        } else if (score >= 70) {
            feedback = "O perfil é sólido e tem bons indicativos. Gostaria de ver mais detalhes sobre os projetos principais (READMEs mais completos) para entender melhor a complexidade do trabalho. É um candidato forte, mas que pode melhorar a apresentação.";
        } else if (score >= 50) {
            feedback = "Vejo potencial, mas o perfil parece um pouco incompleto. A falta de informações claras ou documentação nos projetos gera dúvidas sobre o nível de senioridade. Recomendaria investir mais na 'vitrine' dos projetos para aumentar as chances de contato.";
        } else {
            feedback = "O perfil precisa de atenção urgente. Faltam informações básicas de contato e contexto sobre os projetos. Para um recrutador, é difícil avaliar a competência técnica sem ver atividade recente ou documentação clara. Parece uma conta abandonada.";
        }
        
        if (profileScore < 50) feedback += " <br><br><strong>Dica:</strong> Melhore sua Bio e foto para causar uma primeira impressão melhor.";
        else if (repoScore < 50) feedback += " <br><br><strong>Dica:</strong> Seus repositórios precisam de READMEs melhores para vender seu peixe.";
        
        feedbackEl.innerHTML = feedback;
    }

    if(ui.loaderView) ui.loaderView.classList.add('hidden');
    if(ui.dashboardView) ui.dashboardView.classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    initDOM();
    if(ui.inputs.btn) ui.inputs.btn.addEventListener('click', startAudit);
    if(ui.inputs.user) ui.inputs.user.addEventListener('keypress', e => { if(e.key === 'Enter') startAudit(); });
    
    document.querySelectorAll('.TabNav-item').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.TabNav-item').forEach(t => t.classList.remove('selected'));
            document.querySelectorAll('.TabContent').forEach(c => c.classList.remove('active'));
            tab.classList.add('selected');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
});
