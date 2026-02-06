document.addEventListener('DOMContentLoaded', () => {
    const PROPOSAL_FIREBASE_APP_NAME = window.PROPOSAL_FIREBASE_APP_NAME || 'proposalPortalApp';
    const PROPOSAL_ALLOWED_DOMAIN = 'uctel.co.uk';

    if (window.firebase && firebase.apps) {
        const primaryApp = firebase.apps[0];
        if (primaryApp && primaryApp.options) {
            console.info('Connected Firebase project:', primaryApp.options.projectId);
        } else if (!firebase.apps.length) {
            console.warn('Firebase app is not initialized yet.');
        }
    }

    const getProposalFirebaseAuth = () => {
        if (!window.firebase || !firebase.apps) {
            return null;
        }
        try {
            return firebase.app(PROPOSAL_FIREBASE_APP_NAME).auth();
        } catch (error) {
            return null;
        }
    };

    const ensureProposalPortalAuthUser = async () => {
        const proposalAuth = getProposalFirebaseAuth();
        if (!proposalAuth) {
            throw new Error('Proposal portal authentication is not available yet. Please refresh the page or sign in again.');
        }
        if (proposalAuth.currentUser) {
            return proposalAuth.currentUser;
        }

        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ hd: PROPOSAL_ALLOWED_DOMAIN });
        const result = await proposalAuth.signInWithPopup(provider);
        if (!result.user) {
            throw new Error('Proposal portal sign-in was cancelled.');
        }
        return result.user;
    };

    const waitForPrimaryAuthUser = ({ timeoutMs = 15000 } = {}) => new Promise((resolve, reject) => {
        if (!window.firebase || !firebase.auth) {
            reject(new Error('Firebase auth is not available.'));
            return;
        }

        const authInstance = firebase.auth();
        const existingUser = authInstance.currentUser;
        if (existingUser) {
            resolve(existingUser);
            return;
        }

        let settled = false;
        const timeoutId = window.setTimeout(() => {
            if (!settled) {
                settled = true;
                unsubscribe();
                reject(new Error('Timed out waiting for the user to sign in.'));
            }
        }, timeoutMs);

        const unsubscribe = authInstance.onAuthStateChanged((user) => {
            if (settled) {
                return;
            }
            if (user) {
                settled = true;
                window.clearTimeout(timeoutId);
                unsubscribe();
                resolve(user);
            }
        });
    });

    // --- MAKE.COM WEBHOOK ---
    const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/chemsqrmifjs5lwbrquhh1bha0vo96k2';
    const PDF_MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/cfde3avwbdpr5y131ffkle13z40haem3';
    const DEFAULT_PROPOSAL_APP_BASE_URL = 'https://prop.uctel.co.uk';
    const LOCAL_PROPOSAL_APP_BASE_URL = 'http://localhost:3302';
    const PROPOSAL_BASE_URL_STORAGE_KEY = 'calculator-proposal-base-url';
    const SHARE_STATE_QUERY_PARAM = 'shareState';

    const sanitizeBaseUrl = (value) => {
        if (!value || typeof value !== 'string') {
            return null;
        }

        let candidate = value.trim();
        if (!candidate) {
            return null;
        }

        if (!/^https?:\/\//i.test(candidate)) {
            candidate = `https://${candidate}`;
        }

        try {
            const url = new URL(candidate);
            const pathname = url.pathname.replace(/\/+$/, '');
            return `${url.protocol}//${url.host}${pathname}`;
        } catch (error) {
            console.warn('Ignoring invalid proposal base URL override:', value, error);
            return null;
        }
    };

    const resolveProposalAppBaseUrl = () => {
        let override = null;

        try {
            const searchParams = new URLSearchParams(window.location.search || '');
            override = sanitizeBaseUrl(searchParams.get('proposalBaseUrl'));
            if (override) {
                try {
                    localStorage.setItem(PROPOSAL_BASE_URL_STORAGE_KEY, override);
                } catch (storageError) {
                    console.debug('Unable to persist proposal base URL override:', storageError);
                }
                return override;
            }
        } catch (error) {
            console.debug('Unable to read proposal base URL from query params:', error);
        }

        try {
            override = sanitizeBaseUrl(localStorage.getItem(PROPOSAL_BASE_URL_STORAGE_KEY));
            if (override) {
                return override;
            }
        } catch (error) {
            console.debug('Unable to read persisted proposal base URL override:', error);
        }

        const hostname = window.location.hostname || '';
        const private172Range = /^172\.(1[6-9]|2\d|3[01])\./;
        const isLikelyLocalHost = (
            hostname === '' ||
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname.endsWith('.local') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('192.168.') ||
            private172Range.test(hostname)
        );

        if (isLikelyLocalHost) {
            return LOCAL_PROPOSAL_APP_BASE_URL;
        }

        return DEFAULT_PROPOSAL_APP_BASE_URL;
    };

    const PROPOSAL_APP_BASE_URL = resolveProposalAppBaseUrl();
    const PROPOSAL_API_BASE_URL = PROPOSAL_APP_BASE_URL;
    console.info('Using proposal portal base URL:', PROPOSAL_APP_BASE_URL);
    const LAST_SAVED_SLUG_KEY = 'calculator-last-proposal-slug';
    const SHARE_STATE_STORAGE_KEY = 'calculator-share-state';
    let pendingShareOverrides = null;
    let isApplyingShareState = false;
    let initialViewMode = null;

    // --- DATA ---
    const defaultCoverageData = {
        go: {
            high_band: { sqm: { solid: 56, hollow: 94, cubical: 157, open: 250 }, sqft: { solid: 603, hollow: 1012, cubical: 1690, open: 2691 } },
            low_band: { sqm: { solid: 65, hollow: 148, cubical: 314, open: 590 }, sqft: { solid: 700, hollow: 1593, cubical: 3380, open: 6351 } }
        },
        quatra: {
            high_band: { sqm: { solid: 185, hollow: 319, cubical: 763, open: 1272, open_high_ceiling: 3000 }, sqft: { solid: 1991, hollow: 3434, cubical: 8213, open: 13692, open_high_ceiling: 32292 } },
            low_band: { sqm: { solid: 279, hollow: 464, cubical: 1160, open: 2000, open_high_ceiling: 3000 }, sqft: { solid: 3003, hollow: 4994, cubical: 12486, open: 21528, open_high_ceiling: 32292 } }
        }
    };
    
    // Dynamic coverage data that can be loaded from database
    let coverageData = JSON.parse(JSON.stringify(defaultCoverageData));
    const defaultPriceData = {
        'G41':{label:"GO G41",cost:800.19,margin:0.25},'G43':{label:"GO G43",cost:3149.37,margin:0.25},'QUATRA_NU':{label:"QUATRA 4000e NU",cost:5668.74,margin:0.25},'QUATRA_CU':{label:"QUATRA 4000e CU",cost:3400.74,margin:0.25},'QUATRA_HUB':{label:"QUATRA 4000e HUB",cost:4219.74,margin:0.25},'QUATRA_EVO_NU':{label:"QUATRA EVO NU",cost:2707.74,margin:0.25},'QUATRA_EVO_CU':{label:"QUATRA EVO CU",cost:1731.39,margin:0.25},'QUATRA_EVO_HUB':{label:"QUATRA EVO HUB",cost:2243.8,margin:0.25},'QUATRA_100M_NU':{label:"QUATRA 100M NU",cost:1542.53,margin:0.25},'QUATRA_100M_CU':{label:"QUATRA 100M CU",cost:1479.52,margin:0.25},'QUATRA_100M_PU':{label:"QUATRA 100M PU",cost:471.33,margin:0.25},'extender_cat6':{label:"Q4000 CAT6 Range Extender",cost:426.43,margin:0.25},'extender_fibre_cu':{label:"Q4000 Fibre Extender CU",cost:755.99,margin:0.25},'extender_fibre_nu':{label:"Q4000 Fibre Extender NU",cost:986.61,margin:0.25},'service_antennas':{label:"Omni Ceiling Antenna",cost:11.22,margin:7},'donor_wideband':{label:"Log-periodic Antenna",cost:20.08,margin:5},'donor_lpda':{label:"LPDA-R Antenna",cost:57.87,margin:3.5},'antenna_bracket':{label:"Antenna Bracket",cost:40,margin:0.5},
        'hybrids_4x4':{label:"4x4 Hybrid Combiner",cost:183.05,margin:1.0},
        'hybrids_2x2':{label:"2x2 Hybrid Combiner",cost:30.12,margin:3.0},
        'splitters_4way':{label:"4-Way Splitter",cost:18.36,margin:3},'splitters_3way':{label:"3-Way Splitter",cost:15.36,margin:3},'splitters_2way':{label:"2-Way Splitter",cost:14.18,margin:3},'pigtails':{label:"N-Male to SMA-Male Pigtail",cost:5.02,margin:5},'coax_lmr400':{label:"LMR400/HDF400 Coax Cable",cost:1.25,margin:3},'coax_half':{label:"1/2in Coax Cable",cost:1.78,margin:3},
        'cable_cat':{label:"CAT6 Cable (m)",cost:0.7,margin:0.5},
    'cable_fibre':{label:"Fibre Cable/Patch (100m)",cost:100,margin:0.3},'connectors':{label:"N-Type Connectors",cost:1.42,margin:3},'connectors_rg45':{label:"RJ45 Connectors",cost:0.4,margin:2.5},'adapters_sfp':{label:"SFP Adapter",cost:25,margin:3},
        'adapters_n':{label:"4.3/10 to N Adapter",cost:4.61,margin:5.0},
        'install_internal':{label:"Installation (Internal)",cost:150,margin:3},'install_external':{label:"Installation (External)",cost:600,margin:0.5},'cherry_picker':{label:"Cherry Picker",cost:480,margin:0.3},'travel_expenses':{label:"Travel Expenses",cost:150,margin:0},
        'support_package': {label: "Annual Support Package", cost: 0, margin: 0},
'survey_price_item': {label: "Site Survey", cost: 0, margin: 0}
    };

    const normalizeConsumableLabels = (target) => {
        if (!target) return target;
        if (target.cable_fibre) {
            target.cable_fibre.label = "Fibre Cable/Patch (100m)";
        }
        if (target.cable_cat) {
            target.cable_cat.label = "CAT6 Cable (m)";
        }
        return target;
    };

    const mergePricingData = (defaults, overrides) => {
        const merged = JSON.parse(JSON.stringify(defaults));
        if (overrides && typeof overrides === 'object') {
            Object.keys(overrides).forEach((key) => {
                const override = overrides[key];
                if (override && typeof override === 'object' && !Array.isArray(override)) {
                    const base = merged[key] || {};
                    merged[key] = { ...base, ...override };
                } else {
                    merged[key] = override;
                }
            });
        }
        return normalizeConsumableLabels(merged);
    };
    const alternativePriceOverrides = {
        G41: { cost: 915, margin: 0.15 },
        QUATRA_NU: { cost: 6802.49, margin: 0.15 },
        QUATRA_CU: { cost: 4080.89, margin: 0.15 },
        QUATRA_HUB: { cost: 5063.69, margin: 0.15 },
        extender_cat6: { cost: 891.28, margin: 0.15 },
        extender_fibre_cu: { cost: 1051.04, margin: 0.15 },
        extender_fibre_nu: { cost: 882.04, margin: 0.15 },
        QUATRA_EVO_NU: { cost: 3194.56, margin: 0.15 },
        QUATRA_EVO_CU: { cost: 1858.56, margin: 0.15 },
        QUATRA_EVO_HUB: { cost: 2663.20, margin: 0.15 },
        install_internal: { cost: 137.5, margin: 3.0 }
    };

    const defaultAltPriceData = normalizeConsumableLabels(JSON.parse(JSON.stringify(defaultPriceData)));
    const applyAlternativeOverrides = (target) => {
        Object.entries(alternativePriceOverrides).forEach(([key, override]) => {
            const defaultItem = defaultPriceData[key];
            const existing = target[key];
            const noExisting = !existing;
            const matchesDefault = !!(existing && defaultItem &&
                Math.abs((existing.cost ?? defaultItem.cost) - defaultItem.cost) < 0.01 &&
                Math.abs((existing.margin ?? defaultItem.margin) - defaultItem.margin) < 0.0001);

            if (noExisting || matchesDefault) {
                target[key] = {
                    label: existing?.label || defaultItem?.label || key,
                    cost: override.cost,
                    margin: override.margin
                };
            } else if (existing && !existing.label && defaultItem?.label) {
                existing.label = defaultItem.label;
            }
        });
        normalizeConsumableLabels(target);
    };
    applyAlternativeOverrides(defaultAltPriceData);
    const defaultSupportData = {
        'remote_monitoring': { label: 'Remote Monitoring', description: 'Alerts and events captured on the management portal', dpm: 0.005, tiers: ['silver', 'gold'], type: 'per_system' },
        'reactive_support': { label: 'Reactive Support', description: 'Customer identifies issue and reports to UCtel', dpm: 0.005, tiers: ['bronze', 'silver', 'gold'], type: 'per_system' },
        'proactive_alerting': { label: 'Proactive Alerting', description: 'Events and alerts received from management portal proactively investigated', dpm: 0.005, tiers: ['silver', 'gold'], type: 'per_system' },
        'incident_management': { label: 'Incident Management', description: 'Incident managed via email by UCtel', dpm: 0.01, tiers: ['bronze', 'silver', 'gold'], type: 'per_system' },
        'change_management': { label: 'Change Management', description: 'Remote changes (e.g., change in network operator)', dpm: 0.005, tiers: ['silver', 'gold'], type: 'per_system' },
        'onsite_support': { label: 'On-site support', description: 'Engineer to site for system diagnostic or antenna repositioning', dpm: 0.05, tiers: ['gold'], type: 'fixed_annual' },
        'service_reports': { label: 'Service Reports', description: 'On-Site Annual System Check Up (50k+ Installs)', dpm: 0, tiers: [], type: 'fixed_annual' },
        'service_review': { label: 'Service Review Meetings', description: 'Spare', dpm: 0, tiers: [], type: 'fixed_annual' },
        'maintenance_parts': { label: 'Maintenance (Parts only)', description: 'Break/Fix maintenance - parts to site', dpm: 0.0025, tiers: ['bronze', 'silver'], type: 'fixed_annual' },
        'maintenance_engineer': { label: 'Maintenance (with engineer)', description: 'Break / fix maintenance with engineer to site', dpm: 0.1, tiers: ['gold'], type: 'fixed_annual' }
    };
    let supportData = JSON.parse(JSON.stringify(defaultSupportData));
    const systemCalculators = {
        'G41': params => { const { B_SA, C_Net, D_DA, E_Max } = params; let r = getBaseCalculations(params, 'G41'); const num_systems = (B_SA === 0 || E_Max === 0) ? 0 : Math.ceil(B_SA / E_Max); r.G41 = num_systems * C_Net; const G_DonorPorts = C_Net * num_systems; const SA_per_set = (num_systems === 0) ? 0 : Math.ceil(B_SA / num_systems); const is_4x4 = (C_Net === 4 && SA_per_set >= 3), is_2x2 = (C_Net === 2 && SA_per_set >= 2); let s4=0,s3=0,s2=0; if (is_4x4 || is_2x2) { const num_outputs=is_4x4?4:2,antennas_per_output=Math.ceil(SA_per_set/num_outputs),splitters=getSplitterCascade(antennas_per_output); s4=splitters.d4*num_outputs;s3=splitters.d3*num_outputs;s2=splitters.d2*num_outputs;} else { const d4=(SA_per_set<=1)?0:((SA_per_set===6)?0:((SA_per_set%4===1)?Math.max(0,Math.floor(SA_per_set/4)-1):Math.floor(SA_per_set/4))),d3=(SA_per_set<=1)?0:Math.floor((SA_per_set-4*d4)/3),d2=(SA_per_set<=1)?0:Math.ceil((SA_per_set-4*d4-3*d3)/2),nd=d4+d3+d2; s4=d4+((C_Net===4)?1:0)+((nd===4)?1:0);s3=d3+((C_Net===3)?1:0)+((nd===3)?1:0);s2=d2+((C_Net===2)?1:0)+((nd===2)?1:0);} let d4_way=0,d3_way=0,d2_way=0; if(G_DonorPorts>D_DA&&D_DA>0){ const p_ceil=Math.ceil(G_DonorPorts/D_DA),p_floor=Math.floor(G_DonorPorts/D_DA),n_ceil=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_floor=D_DA-n_ceil; const s_ceil=getSplitterCascade(p_ceil),s_floor=getSplitterCascade(p_floor); d4_way=n_ceil*s_ceil.d4+n_floor*s_floor.d4;d3_way=n_ceil*s_ceil.d3+n_floor*s_floor.d3;d2_way=n_ceil*s_ceil.d2+n_floor*s_floor.d2;} r.hybrids_4x4=is_4x4?num_systems:0;r.hybrids_2x2=is_2x2?num_systems:0; r.splitters_4way=(s4*num_systems)+d4_way;r.splitters_3way=(s3*num_systems)+d3_way;r.splitters_2way=(s2*num_systems)+d2_way; r.pigtails=r.G41+G_DonorPorts; r.connectors=(B_SA+D_DA)+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+(r.hybrids_4x4*8+r.hybrids_2x2*4); r.install_internal=Math.ceil((B_SA/3)+(D_DA/3)+(r.G41/4)+1); return r; },
        'G43': params => { const { B_SA, C_Net, D_DA, E_Max } = params; let r = getBaseCalculations(params, 'G43'); const is_4_nets=(C_Net===4),outputs_per_set=is_4_nets?6:3,max_antennas_per_set=outputs_per_set*E_Max; const num_sets=(B_SA>0&&max_antennas_per_set>0)?Math.ceil(B_SA/max_antennas_per_set):0; r.G43=is_4_nets?(num_sets*2):num_sets;r.hybrids_2x2=is_4_nets?(num_sets*3):0;r.hybrids_4x4=0; const G_DonorPorts=is_4_nets?(num_sets*6):(num_sets*3); let s4_t=0,s3_t=0,s2_t=0; if(B_SA>0&&E_Max>0){const total_outputs=num_sets*outputs_per_set,antennas_per_output=total_outputs>0?Math.ceil(B_SA/total_outputs):0; const splitters=getSplitterCascade(antennas_per_output); s4_t=splitters.d4*total_outputs;s3_t=splitters.d3*total_outputs;s2_t=splitters.d2*total_outputs;} let d4_t=0,d3_t=0,d2_t=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_ceil=Math.ceil(G_DonorPorts/D_DA),p_floor=Math.floor(G_DonorPorts/D_DA),n_ceil=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_floor=D_DA-n_ceil; const s_ceil=getSplitterCascade(p_ceil),s_floor=getSplitterCascade(p_floor); d4_t=n_ceil*s_ceil.d4+n_floor*s_floor.d4;d3_t=n_ceil*s_ceil.d3+n_floor*s_floor.d3;d2_t=n_ceil*s_ceil.d2+n_floor*s_floor.d2;} r.splitters_4way=s4_t+d4_t;r.splitters_3way=s3_t+d3_t;r.splitters_2way=s2_t+d2_t; r.pigtails=is_4_nets?(num_sets*6):0; r.connectors=(B_SA+D_DA)+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+(r.hybrids_4x4*8+r.hybrids_2x2*4); r.install_internal=Math.ceil((B_SA/3)+(D_DA/3)+(r.G43/4)+1); return r; },
    'QUATRA': params => { const { B_SA, C_Net, D_DA } = params; let r=getBaseCalculations(params, 'QUATRA'); r.QUATRA_CU=B_SA; const num_full=Math.floor(r.QUATRA_CU/12),rem_cus=r.QUATRA_CU%12; r.QUATRA_NU=num_full+(rem_cus>0?1:0);r.QUATRA_HUB=num_full+(rem_cus>6?1:0); const G_DonorPorts=4*r.QUATRA_NU;let d4=0,d3=0,d2=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_c=Math.ceil(G_DonorPorts/D_DA),p_f=Math.floor(G_DonorPorts/D_DA),n_c=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_f=D_DA-n_c; const s_c=getSplitterCascade(p_c),s_f=getSplitterCascade(p_f); d4=n_c*s_c.d4+n_f*s_f.d4;d3=n_c*s_c.d3+n_f*s_f.d3;d2=n_c*s_c.d2+n_f*s_f.d2;} r.splitters_4way=d4;r.splitters_3way=d3;r.splitters_2way=d2; r.adapters_n=r.QUATRA_CU+r.QUATRA_NU*C_Net;r.connectors_rg45=r.QUATRA_CU*4; r.cable_fibre=0;r.adapters_sfp=0;r.cable_cat=r.QUATRA_CU*200; r.connectors=(D_DA*2)+(r.QUATRA_CU*2)+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+G_DonorPorts; r.install_internal=Math.ceil((r.QUATRA_CU/2)+(D_DA/2)+(r.QUATRA_NU/7)+1); r.extender_cat6=0;r.extender_fibre_cu=0;r.extender_fibre_nu=0; return r;},
    'QUATRA_DAS': params => { const { B_SA, C_Net, D_DA, E_Max } = params; let r=getBaseCalculations(params, 'QUATRA_DAS'); r.QUATRA_CU=(B_SA===0||E_Max===0)?0:Math.ceil(B_SA/E_Max); const SA_per_set=(r.QUATRA_CU===0)?0:Math.ceil(B_SA/r.QUATRA_CU); const s_per_cu=getSplitterCascade(SA_per_set); const s_4W=s_per_cu.d4*r.QUATRA_CU,s_3W=s_per_cu.d3*r.QUATRA_CU,s_2W=s_per_cu.d2*r.QUATRA_CU; const num_full=Math.floor(r.QUATRA_CU/12),rem_cus=r.QUATRA_CU%12; r.QUATRA_NU=num_full+(rem_cus>0?1:0);r.QUATRA_HUB=num_full+(rem_cus>6?1:0); const G_DonorPorts=4*r.QUATRA_NU;let d4=0,d3=0,d2=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_c=Math.ceil(G_DonorPorts/D_DA),p_f=Math.floor(G_DonorPorts/D_DA),n_c=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_f=D_DA-n_c; const s_c=getSplitterCascade(p_c),s_f=getSplitterCascade(p_f); d4=n_c*s_c.d4+n_f*s_f.d4;d3=n_c*s_c.d3+n_f*s_f.d3;d2=n_c*s_c.d2+n_f*s_f.d2;} r.splitters_4way=s_4W+d4;r.splitters_3way=s_3W+d3;r.splitters_2way=s_2W+d2; r.adapters_n=r.QUATRA_CU+r.QUATRA_NU*C_Net;r.connectors_rg45=r.QUATRA_CU*4; r.cable_fibre=0;r.adapters_sfp=0;r.cable_cat=r.QUATRA_CU*200; r.connectors=(B_SA+(D_DA*2)+(r.QUATRA_CU*2))+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+G_DonorPorts; r.install_internal=Math.ceil((B_SA/3)+(r.QUATRA_CU/2)+(D_DA/2)+(r.QUATRA_NU/7)+1); r.extender_cat6=0;r.extender_fibre_cu=0;r.extender_fibre_nu=0; return r;},
    'QUATRA_EVO': params => { const { B_SA, C_Net, D_DA } = params; let r=getBaseCalculations(params, 'QUATRA_EVO'); r.QUATRA_EVO_CU=B_SA; const num_full=Math.floor(r.QUATRA_EVO_CU/12),rem_cus=r.QUATRA_EVO_CU%12; r.QUATRA_EVO_NU=num_full+(rem_cus>0?1:0);r.QUATRA_EVO_HUB=num_full+(rem_cus>6?1:0); const G_DonorPorts=2*r.QUATRA_EVO_NU;let d4=0,d3=0,d2=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_c=Math.ceil(G_DonorPorts/D_DA),p_f=Math.floor(G_DonorPorts/D_DA),n_c=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_f=D_DA-n_c; const s_c=getSplitterCascade(p_c),s_f=getSplitterCascade(p_f); d4=n_c*s_c.d4+n_f*s_f.d4;d3=n_c*s_c.d3+n_f*s_f.d3;d2=n_c*s_c.d2+n_f*s_f.d2;} r.splitters_4way=d4;r.splitters_3way=d3;r.splitters_2way=d2; r.adapters_n=r.QUATRA_EVO_CU+r.QUATRA_EVO_NU*C_Net;r.connectors_rg45=r.QUATRA_EVO_CU*4; r.cable_fibre=0;r.adapters_sfp=0;r.cable_cat=r.QUATRA_EVO_CU*200; r.connectors=(D_DA*2)+(r.QUATRA_EVO_CU*2)+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+G_DonorPorts; r.install_internal=Math.ceil((r.QUATRA_EVO_CU/2)+(D_DA/2)+(r.QUATRA_EVO_NU/7)+1); r.extender_cat6=0;r.extender_fibre_cu=0;r.extender_fibre_nu=0; return r;},
    'QUATRA_100M': params => {
        const { B_SA, D_DA } = params;
        let r = getBaseCalculations(params, 'QUATRA_100M');
        const cu_count = Math.max(0, B_SA);
        r.QUATRA_100M_CU = cu_count;
        const full_sets = Math.floor(cu_count / 12);
        const remaining_cus = cu_count % 12;
        const nu_count = (cu_count === 0) ? 0 : (full_sets + (remaining_cus > 0 ? 1 : 0));
        r.QUATRA_100M_NU = nu_count;
        const powered_units = cu_count + nu_count;
        r.QUATRA_100M_PU = powered_units > 0 ? Math.ceil(powered_units / 5) : 0;
        r.cable_cat = cu_count * 100;
        r.connectors_rg45 = cu_count * 2;
        r.cable_fibre = cu_count;
        r.adapters_sfp = cu_count * 2;

        const donorAntennas = Math.max(0, Number(D_DA) || 0);
        const donorPorts = Math.max(0, nu_count);
        let donorSplitD4 = 0;
        let donorSplitD3 = 0;
        let donorSplitD2 = 0;

        if (donorPorts > donorAntennas && donorAntennas > 0) {
            const pCeil = Math.ceil(donorPorts / donorAntennas);
            const pFloor = Math.floor(donorPorts / donorAntennas);
            const nCeil = donorPorts % donorAntennas === 0 ? 0 : donorPorts % donorAntennas;
            const nFloor = donorAntennas - nCeil;
            const sCeil = getSplitterCascade(pCeil);
            const sFloor = getSplitterCascade(pFloor);

            donorSplitD4 = (nCeil * sCeil.d4) + (nFloor * sFloor.d4);
            donorSplitD3 = (nCeil * sCeil.d3) + (nFloor * sFloor.d3);
            donorSplitD2 = (nCeil * sCeil.d2) + (nFloor * sFloor.d2);
        }

        r.splitters_4way = donorSplitD4;
        r.splitters_3way = donorSplitD3;
        r.splitters_2way = donorSplitD2;

        const connectorsFromSplitters = (donorSplitD4 * 5) + (donorSplitD3 * 4) + (donorSplitD2 * 3);
        const connectorsForDonors = donorAntennas * 2;
        const connectorsForCus = cu_count * 2;

        r.connectors = connectorsFromSplitters + connectorsForDonors + connectorsForCus;
        r.adapters_n = 0;
        r.extender_cat6 = 0;
        r.extender_fibre_cu = 0;
        r.extender_fibre_nu = 0;
        r.install_internal = Math.ceil((cu_count / 2) + (donorAntennas / 2) + (nu_count / 7) + 1);
        return r;
    },
    'QUATRA_100M_DAS': params => {
        const { B_SA, C_Net, D_DA, E_Max } = params;
        let r = getBaseCalculations(params, 'QUATRA_100M');
        const cu_count = (B_SA === 0 || E_Max === 0) ? 0 : Math.ceil(B_SA / E_Max);
        r.QUATRA_100M_CU = cu_count;

        const saPerCu = cu_count === 0 ? 0 : Math.ceil(B_SA / cu_count);
        const serviceSplitters = getSplitterCascade(saPerCu);
        const serviceSplitters4 = serviceSplitters.d4 * cu_count;
        const serviceSplitters3 = serviceSplitters.d3 * cu_count;
        const serviceSplitters2 = serviceSplitters.d2 * cu_count;

        const full_sets = Math.floor(cu_count / 12);
        const remaining_cus = cu_count % 12;
        const nu_count = (cu_count === 0) ? 0 : (full_sets + (remaining_cus > 0 ? 1 : 0));
        r.QUATRA_100M_NU = nu_count;
        const powered_units = cu_count + nu_count;
        r.QUATRA_100M_PU = powered_units > 0 ? Math.ceil(powered_units / 5) : 0;

        r.cable_cat = cu_count * 100;
        r.connectors_rg45 = cu_count * 2;
        r.cable_fibre = cu_count;
        r.adapters_sfp = cu_count * 2;

        const donorAntennas = Math.max(0, Number(D_DA) || 0);
        const donorPorts = Math.max(0, nu_count);
        let donorSplitD4 = 0;
        let donorSplitD3 = 0;
        let donorSplitD2 = 0;

        if (donorPorts > donorAntennas && donorAntennas > 0) {
            const pCeil = Math.ceil(donorPorts / donorAntennas);
            const pFloor = Math.floor(donorPorts / donorAntennas);
            const nCeil = donorPorts % donorAntennas === 0 ? 0 : donorPorts % donorAntennas;
            const nFloor = donorAntennas - nCeil;
            const sCeil = getSplitterCascade(pCeil);
            const sFloor = getSplitterCascade(pFloor);

            donorSplitD4 = (nCeil * sCeil.d4) + (nFloor * sFloor.d4);
            donorSplitD3 = (nCeil * sCeil.d3) + (nFloor * sFloor.d3);
            donorSplitD2 = (nCeil * sCeil.d2) + (nFloor * sFloor.d2);
        }

        const totalSplitters4 = serviceSplitters4 + donorSplitD4;
        const totalSplitters3 = serviceSplitters3 + donorSplitD3;
        const totalSplitters2 = serviceSplitters2 + donorSplitD2;

        r.splitters_4way = totalSplitters4;
        r.splitters_3way = totalSplitters3;
        r.splitters_2way = totalSplitters2;

        const connectorsFromSplitters = (totalSplitters4 * 5) + (totalSplitters3 * 4) + (totalSplitters2 * 3);
        const connectorsForServiceAntennas = Math.max(0, B_SA);
        const connectorsForDonors = donorAntennas * 2;
        const connectorsForCus = cu_count * 2;
        const connectorsForDonorPorts = donorPorts;

        r.connectors = connectorsFromSplitters + connectorsForServiceAntennas + connectorsForDonors + connectorsForCus + connectorsForDonorPorts;
        r.adapters_n = 0;
        r.extender_cat6 = 0;
        r.extender_fibre_cu = 0;
        r.extender_fibre_nu = 0;
        r.install_internal = Math.ceil((B_SA / 3) + (cu_count / 2) + (donorAntennas / 2) + (nu_count / 7) + 1);
        return r;
    },
    'QUATRA_EVO_DAS': params => { const { B_SA, C_Net, D_DA, E_Max } = params; let r=getBaseCalculations(params, 'QUATRA_EVO_DAS'); r.QUATRA_EVO_CU=(B_SA===0||E_Max===0)?0:Math.ceil(B_SA/E_Max); const SA_per_set=(r.QUATRA_EVO_CU===0)?0:Math.ceil(B_SA/r.QUATRA_EVO_CU); const s_per_cu=getSplitterCascade(SA_per_set); const s_4W=s_per_cu.d4*r.QUATRA_EVO_CU,s_3W=s_per_cu.d3*r.QUATRA_EVO_CU,s_2W=s_per_cu.d2*r.QUATRA_EVO_CU; const num_full=Math.floor(r.QUATRA_EVO_CU/12),rem_cus=r.QUATRA_EVO_CU%12; r.QUATRA_EVO_NU=num_full+(rem_cus>0?1:0);r.QUATRA_EVO_HUB=num_full+(rem_cus>6?1:0); const G_DonorPorts=2*r.QUATRA_EVO_NU;let d4=0,d3=0,d2=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_c=Math.ceil(G_DonorPorts/D_DA),p_f=Math.floor(G_DonorPorts/D_DA),n_c=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_f=D_DA-n_c; const s_c=getSplitterCascade(p_c),s_f=getSplitterCascade(p_f); d4=n_c*s_c.d4+n_f*s_f.d4;d3=n_c*s_c.d3+n_f*s_f.d3;d2=n_c*s_c.d2+n_f*s_f.d2;} r.splitters_4way=s_4W+d4;r.splitters_3way=s_3W+d3;r.splitters_2way=s_2W+d2; r.adapters_n=r.QUATRA_EVO_CU+r.QUATRA_EVO_NU*C_Net;r.connectors_rg45=r.QUATRA_EVO_CU*4; r.cable_fibre=0;r.adapters_sfp=0;r.cable_cat=r.QUATRA_EVO_CU*200; r.connectors=(B_SA+(D_DA*2)+(r.QUATRA_EVO_CU*2))+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+G_DonorPorts; r.install_internal=Math.ceil((B_SA/3)+(r.QUATRA_EVO_CU/2)+(D_DA/2)+(r.QUATRA_EVO_NU/7)+1); r.extender_cat6=0;r.extender_fibre_cu=0;r.extender_fibre_nu=0; return r;}
    };

    const QUATRA_VARIANT_CONFIGS = {
        QUATRA: {
            cuKey: 'QUATRA_CU',
            nuKey: 'QUATRA_NU',
            hubKey: 'QUATRA_HUB',
            connectorsPerCu: 4,
            catLengthPerCu: 200,
            fibrePerCu: 0,
            sfpPerCu: 0,
            nTypeConnectorsPerCu: 2,
            nTypeConnectorsPerDonor: 2,
            adaptersCalculator: (nuCount, cuCount, networks) => cuCount + (nuCount * networks),
            isDas: false
        },
        QUATRA_DAS: {
            cuKey: 'QUATRA_CU',
            nuKey: 'QUATRA_NU',
            hubKey: 'QUATRA_HUB',
            connectorsPerCu: 4,
            catLengthPerCu: 200,
            fibrePerCu: 0,
            sfpPerCu: 0,
            nTypeConnectorsPerCu: 2,
            nTypeConnectorsPerDonor: 2,
            adaptersCalculator: (nuCount, cuCount, networks) => cuCount + (nuCount * networks),
            isDas: true
        },
        QUATRA_EVO: {
            cuKey: 'QUATRA_EVO_CU',
            nuKey: 'QUATRA_EVO_NU',
            hubKey: 'QUATRA_EVO_HUB',
            connectorsPerCu: 4,
            catLengthPerCu: 200,
            fibrePerCu: 0,
            sfpPerCu: 0,
            nTypeConnectorsPerCu: 2,
            nTypeConnectorsPerDonor: 2,
            adaptersCalculator: (nuCount, cuCount, networks) => cuCount + (nuCount * networks),
            isDas: false
        },
        QUATRA_EVO_DAS: {
            cuKey: 'QUATRA_EVO_CU',
            nuKey: 'QUATRA_EVO_NU',
            hubKey: 'QUATRA_EVO_HUB',
            connectorsPerCu: 4,
            catLengthPerCu: 200,
            fibrePerCu: 0,
            sfpPerCu: 0,
            nTypeConnectorsPerCu: 2,
            nTypeConnectorsPerDonor: 2,
            adaptersCalculator: (nuCount, cuCount, networks) => cuCount + (nuCount * networks),
            isDas: true
        },
        QUATRA_100M: {
            cuKey: 'QUATRA_100M_CU',
            nuKey: 'QUATRA_100M_NU',
            hubKey: null,
            connectorsPerCu: 2,
            catLengthPerCu: 100,
            fibrePerCu: 1,
            sfpPerCu: 2,
            nTypeConnectorsPerCu: 2,
            nTypeConnectorsPerDonor: 2,
            adaptersCalculator: (nuCount, cuCount) => nuCount + cuCount,
            isDas: false
        },
        QUATRA_100M_DAS: {
            cuKey: 'QUATRA_100M_CU',
            nuKey: 'QUATRA_100M_NU',
            hubKey: null,
            connectorsPerCu: 2,
            catLengthPerCu: 100,
            fibrePerCu: 1,
            sfpPerCu: 2,
            nTypeConnectorsPerCu: 2,
            nTypeConnectorsPerDonor: 2,
            adaptersCalculator: (nuCount, cuCount) => nuCount + cuCount,
            isDas: true
        }
    };

    // Create default Old Price Data with same cost but margin reduced by 10% (absolute)
    const createDefaultOldPriceData = () => {
        const oldData = normalizeConsumableLabels(JSON.parse(JSON.stringify(defaultPriceData)));
        for (const key in oldData) {
            oldData[key].margin = Math.max(0, oldData[key].margin - 0.1);
        }
        return oldData;
    };
    const defaultOldPriceData = createDefaultOldPriceData();

    let priceData = {};
    let altPriceData = {};
    let oldPriceData = {};
    let useAltPricing = false;
    let useOldPricing = false;
    let lastPersistedUseAltPricing = false;
    let lastPersistedUseOldPricing = false;
    let currentResults = {};
    let showZeroQuantityItems = false;
    let subTotalsForProposal = {};
    let supportPriceOverrides = { bronze: null, silver: null, gold: null };
    let isDataInitialized = false;
    let saveStatusMessageTimeout = null;

    const showSaveStatusMessage = (message, tone = 'success', autoHideMs = 4000) => {
        const statusMessage = document.getElementById('save-status-message');
        if (!statusMessage) {
            return;
        }

        statusMessage.textContent = message;
        statusMessage.classList.remove('hidden', 'save-status-success', 'save-status-error');
        const toneClass = tone === 'error' ? 'save-status-error' : 'save-status-success';
        statusMessage.classList.add(toneClass);

        if (saveStatusMessageTimeout) {
            clearTimeout(saveStatusMessageTimeout);
            saveStatusMessageTimeout = null;
        }

        if (autoHideMs > 0) {
            saveStatusMessageTimeout = window.setTimeout(() => {
                statusMessage.classList.add('hidden');
            }, autoHideMs);
        }
    };

    const updateAltPricingIndicator = () => {
        const indicator = document.getElementById('alt-pricing-indicator');
        const altPricingToggle = document.getElementById('alt-pricing-toggle');
        const oldPricingToggle = document.getElementById('old-pricing-toggle');
        if (altPricingToggle && altPricingToggle.checked !== useAltPricing) {
            altPricingToggle.checked = useAltPricing;
        }
        if (oldPricingToggle && oldPricingToggle.checked !== useOldPricing) {
            oldPricingToggle.checked = useOldPricing;
        }
        if (!indicator) return;
        if ((useAltPricing || useOldPricing) && isDataInitialized) {
            indicator.classList.remove('hidden');
            indicator.textContent = useOldPricing ? 'Old Margin pricing is ON' : 'Alternative pricing is ON';
        } else {
            indicator.classList.add('hidden');
        }
    };

    function setupSettingsModal() {
        const modal = document.getElementById('settings-modal');
        const btn = document.getElementById('settings-btn');
        const closeBtn = modal.querySelector('.close-btn');
        const cancelBtn = document.getElementById('modal-cancel');
        const saveBtn = document.getElementById('modal-save');

        if (saveBtn) {
            saveBtn.disabled = true;
        }

        const collectModalFields = () => Array.from(modal.querySelectorAll('input, select, textarea'));

        const buildFieldIdentifier = (element, index) => {
            if (element.id) return element.id;
            if (element.name) return element.name;
            if (element.dataset) {
                const dataAttributes = Object.keys(element.dataset)
                    .sort()
                    .map(key => `${key}:${element.dataset[key]}`)
                    .join('|');
                if (dataAttributes) {
                    return `${element.tagName.toLowerCase()}[${dataAttributes}]`;
                }
            }
            return `${element.tagName.toLowerCase()}#${index}`;
        };

        const computeModalSnapshot = () => collectModalFields()
            .map((element, index) => {
                const identifier = buildFieldIdentifier(element, index);
                const value = (element.type === 'checkbox' || element.type === 'radio') ? element.checked : element.value;
                return `${identifier}=${value}`;
            })
            .join('|');

        const updateSaveButtonState = () => {
            if (!saveBtn) return;
            const baseline = modal.dataset.initialSettingsSnapshot || '';
            const current = computeModalSnapshot();
            const hasFieldChanges = current !== baseline;
            const altPricingDirty = useAltPricing !== lastPersistedUseAltPricing;
            saveBtn.disabled = !(hasFieldChanges || altPricingDirty);
        };

        window.__updateSettingsSaveState = updateSaveButtonState;

        const registerInitialSnapshot = () => {
            modal.dataset.initialSettingsSnapshot = computeModalSnapshot();
        };

        const handleModalValueChange = () => updateSaveButtonState();

        modal.addEventListener('input', handleModalValueChange);
        modal.addEventListener('change', handleModalValueChange);

        const closeModal = () => {
            modal.style.display = 'none';
        };

        const openModal = () => {
            populateSettingsModal();
            populateCoverageModal();
            registerInitialSnapshot();
            updateSaveButtonState();
            modal.style.display = 'block';
        };

        btn.onclick = openModal;
        closeBtn.onclick = closeModal;
        cancelBtn.onclick = closeModal;
        window.onclick = (event) => { if (event.target === modal) closeModal(); };

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const newPriceData = JSON.parse(JSON.stringify(priceData));
                const newAltPriceData = {};
                const newOldPriceData = {};
                const newCoverageData = JSON.parse(JSON.stringify(coverageData));
                const newSupportData = JSON.parse(JSON.stringify(supportData));
                let allValid = true;

                for (const key in newPriceData) {
                    const costInput = document.getElementById(`cost-${key}`);
                    const marginInput = document.getElementById(`margin-${key}`);
                    const altCostInput = document.getElementById(`alt-cost-${key}`);
                    const altMarginInput = document.getElementById(`alt-margin-${key}`);
                    const oldCostInput = document.getElementById(`old-cost-${key}`);
                    const oldMarginInput = document.getElementById(`old-margin-${key}`);

                    const newCost = costInput ? parseFloat(costInput.value) : NaN;
                    const newMargin = marginInput ? parseFloat(marginInput.value) / 100 : NaN;
                    const newAltCost = altCostInput ? parseFloat(altCostInput.value) : NaN;
                    const newAltMargin = altMarginInput ? parseFloat(altMarginInput.value) / 100 : NaN;
                    const newOldCost = oldCostInput ? parseFloat(oldCostInput.value) : NaN;
                    const newOldMargin = oldMarginInput ? parseFloat(oldMarginInput.value) / 100 : NaN;

                    if (!isNaN(newCost) && !isNaN(newMargin) && !isNaN(newAltCost) && !isNaN(newAltMargin) && !isNaN(newOldCost) && !isNaN(newOldMargin)) {
                        newPriceData[key].cost = newCost;
                        newPriceData[key].margin = newMargin;
                        newAltPriceData[key] = {
                            label: newPriceData[key].label,
                            cost: newAltCost,
                            margin: newAltMargin
                        };
                        newOldPriceData[key] = {
                            label: newPriceData[key].label,
                            cost: newOldCost,
                            margin: newOldMargin
                        };
                    } else {
                        allValid = false;
                    }
                }

                Object.keys(newCoverageData).forEach(systemType => {
                    Object.keys(newCoverageData[systemType]).forEach(band => {
                        ['sqm', 'sqft'].forEach(unit => {
                            Object.keys(newCoverageData[systemType][band][unit]).forEach(wallType => {
                                const inputId = `coverage-${systemType}-${band}-${unit}-${wallType}`;
                                const input = document.getElementById(inputId);
                                if (input) {
                                    const value = parseFloat(input.value);
                                    if (!isNaN(value) && value >= 0) {
                                        newCoverageData[systemType][band][unit][wallType] = value;
                                    } else {
                                        allValid = false;
                                    }
                                }
                            });
                        });
                    });
                });

                // Collect support data from checkboxes and dpm inputs
                const maintenancePercent = parseFloat(document.getElementById('maintenance-percent').value) || 5;
                for (const key in newSupportData) {
                    const dpmInput = document.querySelector(`.dpm-input[data-key="${key}"]`);
                    if (dpmInput) {
                        const dpmValue = parseFloat(dpmInput.value);
                        if (!isNaN(dpmValue)) {
                            newSupportData[key].dpm = dpmValue;
                        }
                    }
                    // Collect which tiers are checked for this service
                    const tiers = [];
                    ['bronze', 'silver', 'gold'].forEach(tier => {
                        const checkbox = document.querySelector(`.support-checkbox[data-key="${key}"][data-tier="${tier}"]`);
                        if (checkbox && checkbox.checked) {
                            tiers.push(tier);
                        }
                    });
                    newSupportData[key].tiers = tiers;
                }

                const altPricingCheckbox = document.getElementById('alt-pricing-toggle');
                const oldPricingCheckbox = document.getElementById('old-pricing-toggle');
                const newUseAltPricing = altPricingCheckbox ? altPricingCheckbox.checked : false;
                const newUseOldPricing = oldPricingCheckbox ? oldPricingCheckbox.checked : false;

                // Add maintenance percent to support data for saving
                newSupportData.maintenancePercent = maintenancePercent;

                if (allValid) {
                    await savePrices(newPriceData, newAltPriceData, newOldPriceData, newSupportData, newUseAltPricing, newUseOldPricing);
                    await saveCoverageData(newCoverageData);
                    registerInitialSnapshot();
                    updateSaveButtonState();
                    closeModal();
                } else {
                    alert('Please ensure all values are valid numbers.');
                }
            });
        }

        const tabLinks = modal.querySelectorAll('.tab-link');
        const tabContents = modal.querySelectorAll('.tab-content');

        tabLinks.forEach(link => {
            link.addEventListener('click', () => {
                const tabId = link.dataset.tab;
                tabLinks.forEach(item => item.classList.remove('active'));
                tabContents.forEach(item => item.classList.remove('active'));
                link.classList.add('active');
                modal.querySelector(`#${tabId}`).classList.add('active');
            });
        });
    }

    function populateSettingsModal() {
        const container = document.getElementById('settings-form-container');
        let html = `
            <div class="setting-item setting-header">
                <span>Component</span>
                <span>Cost (£)</span>
                <span>Margin (%)</span>
                <span>Sell (£)</span>
                <span>Alt Cost (£)</span>
                <span>Alt Margin (%)</span>
                <span>Alt Sell (£)</span>
                <span>Old Cost (£)</span>
                <span>Old Margin (%)</span>
                <span>Old Sell (£)</span>
            </div>`;
        const sortedKeys = Object.keys(priceData).sort((a, b) => priceData[a].label.localeCompare(priceData[b].label));
        for(const key of sortedKeys) {
            const item = priceData[key];
            const altItem = altPriceData[key] || { cost: item.cost, margin: item.margin };
            const oldItem = oldPriceData[key] || { cost: item.cost, margin: Math.max(0, item.margin - 0.1) };
            const sellPrice = item.cost * (1 + item.margin);
            const altSellPrice = altItem.cost * (1 + altItem.margin);
            const oldSellPrice = oldItem.cost * (1 + oldItem.margin);
            html += `<div class="setting-item">
                <label for="cost-${key}">${item.label}</label>
                <input type="number" step="0.01" id="cost-${key}" value="${item.cost.toFixed(2)}">
                <input type="number" step="0.01" id="margin-${key}" value="${(item.margin * 100).toFixed(2)}">
                <span id="sell-${key}" class="sell-price-display">£${sellPrice.toFixed(2)}</span>
                <input type="number" step="0.01" id="alt-cost-${key}" value="${altItem.cost.toFixed(2)}">
                <input type="number" step="0.01" id="alt-margin-${key}" value="${(altItem.margin * 100).toFixed(2)}">
                <span id="alt-sell-${key}" class="sell-price-display">£${altSellPrice.toFixed(2)}</span>
                <input type="number" step="0.01" id="old-cost-${key}" value="${oldItem.cost.toFixed(2)}">
                <input type="number" step="0.01" id="old-margin-${key}" value="${(oldItem.margin * 100).toFixed(2)}">
                <span id="old-sell-${key}" class="sell-price-display">£${oldSellPrice.toFixed(2)}</span>
            </div>`;
        }
        container.innerHTML = html;
    
        for(const key of sortedKeys) {
            const costInput = document.getElementById(`cost-${key}`);
            const marginInput = document.getElementById(`margin-${key}`);
            const altCostInput = document.getElementById(`alt-cost-${key}`);
            const altMarginInput = document.getElementById(`alt-margin-${key}`);
            const oldCostInput = document.getElementById(`old-cost-${key}`);
            const oldMarginInput = document.getElementById(`old-margin-${key}`);
            
            const handler = () => window.updateSellPriceDisplay(key);
            const altHandler = () => window.updateAltSellPriceDisplay(key);
            const oldHandler = () => window.updateOldSellPriceDisplay(key);
            
            if(costInput) costInput.addEventListener('input', handler);
            if(marginInput) marginInput.addEventListener('input', handler);
            if(altCostInput) altCostInput.addEventListener('input', altHandler);
            if(altMarginInput) altMarginInput.addEventListener('input', altHandler);
            if(oldCostInput) oldCostInput.addEventListener('input', oldHandler);
            if(oldMarginInput) oldMarginInput.addEventListener('input', oldHandler);
        }

        updateAltPricingIndicator();
    }

    // Populate coverage settings modal
    function populateCoverageModal() {
        const container = document.getElementById('coverage-form-container');
        let html = `
            <h3>Antenna Coverage Settings</h3>
            <p>Configure antenna coverage areas (in square meters or square feet) for different system types, frequency bands, and wall types.</p>
        `;
        
        // Create sections for each system type
        Object.keys(coverageData).forEach(systemType => {
            const systemLabel = systemType === 'go' ? 'GO Systems (G41/G43) & QUATRA/EVO DAS Systems' : 'QUATRA Systems (4000e/EVO)';
            html += `<div class="coverage-section">
                <h4>${systemLabel}</h4>`;
            
            Object.keys(coverageData[systemType]).forEach(band => {
                const bandLabel = band === 'high_band' ? 'High Band' : 'Low Band';
                html += `<h5 style="margin: 15px 15px 10px; color: #666; font-size: 13px;">${bandLabel}</h5>
                    <table class="coverage-table">
                        <thead>
                            <tr>
                                <th>Wall Type</th>
                                <th>Square Meters</th>
                                <th>Radius (m)</th>
                                <th>Square Feet</th>
                                <th>Radius (ft)</th>
                            </tr>
                        </thead>
                        <tbody>`;
                
                const wallTypes = ['solid', 'hollow', 'cubical', 'open'];
                if (systemType === 'quatra') {
                    wallTypes.push('open_high_ceiling');
                }
                
                wallTypes.forEach(wallType => {
                    const wallLabel = wallType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                    const sqmValue = coverageData[systemType][band].sqm[wallType] || 0;
                    const sqftValue = coverageData[systemType][band].sqft[wallType] || 0;
                    
                    // Calculate radius from area (radius = sqrt(area / π))
                    const radiusM = sqmValue > 0 ? Math.sqrt(sqmValue / Math.PI).toFixed(1) : '0.0';
                    const radiusFt = sqftValue > 0 ? Math.sqrt(sqftValue / Math.PI).toFixed(1) : '0.0';
                    
                    html += `<tr>
                        <td><strong>${wallLabel}</strong></td>
                        <td><input type="number" id="coverage-${systemType}-${band}-sqm-${wallType}" value="${sqmValue}" min="0" step="1"></td>
                        <td style="background-color: #f8f9fa; color: #666; text-align: center; font-weight: bold;">${radiusM}</td>
                        <td><input type="number" id="coverage-${systemType}-${band}-sqft-${wallType}" value="${sqftValue}" min="0" step="1"></td>
                        <td style="background-color: #f8f9fa; color: #666; text-align: center; font-weight: bold;">${radiusFt}</td>
                    </tr>`;
                });
                
                html += `</tbody></table>`;
            });
            
            html += `</div>`;
        });
        
        container.innerHTML = html;
        
        // Add event listeners to update radius calculations when coverage values change
        setupCoverageRadiusUpdates();
    }
    
    // Function to setup automatic radius updates in coverage modal
    function setupCoverageRadiusUpdates() {
        // Find all coverage input fields and add change listeners
        document.querySelectorAll('[id^="coverage-"]').forEach(input => {
            if (input.type === 'number') {
                input.addEventListener('input', function() {
                    updateRadiusDisplay(this);
                });
            }
        });
    }
    
    // Function to update radius display for a specific input
    function updateRadiusDisplay(input) {
        const value = parseFloat(input.value) || 0;
        const radius = value > 0 ? Math.sqrt(value / Math.PI).toFixed(1) : '0.0';
        
        // Find the corresponding radius cell (next sibling for sqm, or cell after next for sqft)
        const row = input.closest('tr');
        const cells = row.querySelectorAll('td');
        const inputCell = input.closest('td');
        const inputIndex = Array.from(cells).indexOf(inputCell);
        
        // Update the radius cell (column 2 for sqm radius, column 4 for sqft radius)
        if (inputIndex === 1) { // sqm input (column 1)
            const radiusCell = cells[2]; // radius (m) column
            radiusCell.textContent = radius;
        } else if (inputIndex === 3) { // sqft input (column 3)
            const radiusCell = cells[4]; // radius (ft) column
            radiusCell.textContent = radius;
        }
    }
    // Helper function for updating alternative sell price displays
    window.updateAltSellPriceDisplay = function(key) {
        const altCostInput = document.getElementById(`alt-cost-${key}`);
        const altMarginInput = document.getElementById(`alt-margin-${key}`);
        const altSellDisplay = document.getElementById(`alt-sell-${key}`);
        
        if (altCostInput && altMarginInput && altSellDisplay) {
            const altCost = parseFloat(altCostInput.value) || 0;
            const altMargin = parseFloat(altMarginInput.value) / 100 || 0;
            const altSellPrice = altCost * (1 + altMargin);
            altSellDisplay.textContent = `£${altSellPrice.toFixed(2)}`;
        }
    };

    // Helper function for updating old margin sell price displays
    window.updateOldSellPriceDisplay = function(key) {
        const oldCostInput = document.getElementById(`old-cost-${key}`);
        const oldMarginInput = document.getElementById(`old-margin-${key}`);
        const oldSellDisplay = document.getElementById(`old-sell-${key}`);
        
        if (oldCostInput && oldMarginInput && oldSellDisplay) {
            const oldCost = parseFloat(oldCostInput.value) || 0;
            const oldMargin = parseFloat(oldMarginInput.value) / 100 || 0;
            const oldSellPrice = oldCost * (1 + oldMargin);
            oldSellDisplay.textContent = `£${oldSellPrice.toFixed(2)}`;
        }
    };

    function populateSupportTable() {
        const table = document.getElementById('support-table');
        if (!table) return;
        console.log('populateSupportTable called, supportData:', JSON.stringify(supportData, null, 2));
        let html = `<thead><tr><th>Included Services</th><th>Description</th><th>Bronze</th><th>Silver</th><th>Gold</th><th>dpm/sys</th><th>dpy/sys</th></tr></thead><tbody>`;
        for (const key in supportData) {
            if (key === 'maintenancePercent') continue; // Skip non-service keys
            const item = supportData[key];
            const dpy = item.dpm * 12;
            const bronzeChecked = item.tiers.includes('bronze') ? 'checked' : '';
            const silverChecked = item.tiers.includes('silver') ? 'checked' : '';
            const goldChecked = item.tiers.includes('gold') ? 'checked' : '';
            console.log(`${key}: tiers=${JSON.stringify(item.tiers)}, bronze=${bronzeChecked}, silver=${silverChecked}, gold=${goldChecked}`);
            html += `<tr><td>${item.label}</td><td>${item.description}</td>
                <td><input type="checkbox" class="support-checkbox" data-key="${key}" data-tier="bronze" ${bronzeChecked}></td>
                <td><input type="checkbox" class="support-checkbox" data-key="${key}" data-tier="silver" ${silverChecked}></td>
                <td><input type="checkbox" class="support-checkbox" data-key="${key}" data-tier="gold" ${goldChecked}></td>
                <td><input type="number" class="dpm-input" data-key="${key}" value="${item.dpm.toFixed(4)}" step="0.0001"></td>
                <td><span id="dpy-${key}">${dpy.toFixed(4)}</span></td></tr>`;
        }
        html += `</tbody><tfoot>
            <tr class="summary-row"><td colspan="2" style="text-align:right;">Services per system (×<span id="hardware-units-count">0</span> units)</td><td id="bronze-sys-summary">£0.00</td><td id="silver-sys-summary">£0.00</td><td id="gold-sys-summary">£0.00</td><td colspan="2"></td></tr>
            <tr class="summary-row"><td colspan="2" style="text-align:right;">Fixed annual services</td><td id="bronze-year-summary">£0.00</td><td id="silver-year-summary">£0.00</td><td id="gold-year-summary">£0.00</td><td colspan="2"></td></tr>
            <tr class="summary-row"><td colspan="2" style="text-align:right;">Maintenance (<span id="maint-percent-display">5</span>% of hardware)</td><td id="bronze-maint-summary">£0.00</td><td id="silver-maint-summary">£0.00</td><td id="gold-maint-summary">£0.00</td><td colspan="2"></td></tr>
            <tr class="summary-row" style="font-weight:bold;background:#f0f0f0;"><td colspan="2" style="text-align:right;">Total annual support cost</td><td id="bronze-total-summary">£0.00</td><td id="silver-total-summary">£0.00</td><td id="gold-total-summary">£0.00</td><td colspan="2"></td></tr>
        </tfoot>`;
        table.innerHTML = html;
        document.querySelectorAll('.support-checkbox').forEach(box => box.addEventListener('change', () => {
            document.querySelectorAll('.support-presets-main button').forEach(b => b.classList.remove('active-preset'));
            updateSupportTableSummaries();
            runFullCalculation();
        }));
        document.querySelectorAll('.dpm-input').forEach(el => {
            el.addEventListener('input', (e) => {
                const key = e.target.dataset.key;
                const dpySpan = document.getElementById(`dpy-${key}`);
                const dpmValue = parseFloat(e.target.value) || 0;
                if (dpySpan) dpySpan.textContent = (dpmValue * 12).toFixed(4);
                updateSupportTableSummaries();
            });
            el.addEventListener('change', runFullCalculation);
        });
        // Add listener for maintenance percent input
        const maintInput = document.getElementById('maintenance-percent');
        if (maintInput) {
            maintInput.addEventListener('input', updateSupportTableSummaries);
            maintInput.addEventListener('change', runFullCalculation);
        }
        // Calculate initial summaries
        updateSupportTableSummaries();
    }

  // calculator.js

// REPLACE the old loadPrices function with this new async version
async function loadPrices() {
    const pricesDocRef = firebase.firestore().collection('settings').doc('prices');
    const altPricesDocRef = firebase.firestore().collection('settings').doc('altPrices');
    const oldPricesDocRef = firebase.firestore().collection('settings').doc('oldPrices');
    const supportDocRef = firebase.firestore().collection('settings').doc('support');
    const settingsDocRef = firebase.firestore().collection('settings').doc('general');
    
    try {
        // Load standard prices
        const doc = await pricesDocRef.get();
        if (doc.exists) {
            console.log("Prices loaded from Firestore.");
            const firestorePrices = doc.data();
            priceData = mergePricingData(defaultPriceData, firestorePrices);
        } else {
            console.log("No prices document in Firestore, using default data.");
            priceData = normalizeConsumableLabels(JSON.parse(JSON.stringify(defaultPriceData)));
        }

        // Load alternative prices
        const altDoc = await altPricesDocRef.get();
        if (altDoc.exists) {
            console.log("Alternative prices loaded from Firestore.");
            const firestoreAltPrices = altDoc.data() || {};
            const mergedAltPrices = mergePricingData(defaultAltPriceData, firestoreAltPrices);
            applyAlternativeOverrides(mergedAltPrices);
            altPriceData = mergedAltPrices;
        } else {
            console.log("No alternative prices document, initializing with default data.");
            const altDefaults = normalizeConsumableLabels(JSON.parse(JSON.stringify(defaultAltPriceData)));
            applyAlternativeOverrides(altDefaults);
            altPriceData = altDefaults;
        }

        // Load old margin prices
        const oldDoc = await oldPricesDocRef.get();
        if (oldDoc.exists) {
            console.log("Old margin prices loaded from Firestore.");
            const firestoreOldPrices = oldDoc.data() || {};
            oldPriceData = mergePricingData(defaultOldPriceData, firestoreOldPrices);
        } else {
            console.log("No old margin prices document, initializing with default data.");
            oldPriceData = normalizeConsumableLabels(JSON.parse(JSON.stringify(defaultOldPriceData)));
        }

        // Load support data
        const supportDoc = await supportDocRef.get();
        if (supportDoc.exists) {
            console.log("Support data loaded from Firestore.");
            const firestoreSupport = supportDoc.data() || {};
            // Load maintenance percentage if it exists
            if (firestoreSupport.maintenancePercent !== undefined) {
                document.getElementById('maintenance-percent').value = firestoreSupport.maintenancePercent;
            }
            // Merge with defaults to ensure all keys exist
            supportData = JSON.parse(JSON.stringify(defaultSupportData));
            for (const key in firestoreSupport) {
                if (key !== 'maintenancePercent' && supportData[key]) {
                    supportData[key] = { ...supportData[key], ...firestoreSupport[key] };
                }
            }
        } else {
            console.log("No support document in Firestore, using default data.");
            supportData = JSON.parse(JSON.stringify(defaultSupportData));
        }

        // Load settings (including useAltPricing and useOldPricing flags)
        const settingsDoc = await settingsDocRef.get();
        if (settingsDoc.exists) {
            const settings = settingsDoc.data();
            useAltPricing = settings.useAltPricing || false;
            useOldPricing = settings.useOldPricing || false;
            console.log("Settings loaded from Firestore. Use Alt Pricing:", useAltPricing, "Use Old Pricing:", useOldPricing);
        } else {
            useAltPricing = false;
            useOldPricing = false;
        }
        lastPersistedUseAltPricing = useAltPricing;
        lastPersistedUseOldPricing = useOldPricing;
        updateAltPricingIndicator();
        
    } catch (e) {
        console.error("Could not load pricing data from Firestore.", e);
        throw e;
    }
}
   async function savePrices(newPriceData, newAltPriceData, newOldPriceData, newSupportData, newUseAltPricing, newUseOldPricing) {
    const pricesDocRef = firebase.firestore().collection('settings').doc('prices');
    const altPricesDocRef = firebase.firestore().collection('settings').doc('altPrices');
    const oldPricesDocRef = firebase.firestore().collection('settings').doc('oldPrices');
    const supportDocRef = firebase.firestore().collection('settings').doc('support');
    const settingsDocRef = firebase.firestore().collection('settings').doc('general');
    
    try {
        normalizeConsumableLabels(newPriceData);
        normalizeConsumableLabels(newAltPriceData);
        normalizeConsumableLabels(newOldPriceData);
        // Save all the data in parallel
        await Promise.all([
            pricesDocRef.set(newPriceData),
            altPricesDocRef.set(newAltPriceData),
            oldPricesDocRef.set(newOldPriceData),
            supportDocRef.set(newSupportData),
            settingsDocRef.set({ useAltPricing: newUseAltPricing, useOldPricing: newUseOldPricing }, { merge: true })
        ]);
        
        // Update local variables
    priceData = normalizeConsumableLabels(newPriceData);
    altPriceData = normalizeConsumableLabels(newAltPriceData);
    oldPriceData = normalizeConsumableLabels(newOldPriceData);
    supportData = JSON.parse(JSON.stringify(newSupportData));
    useAltPricing = newUseAltPricing;
    useOldPricing = newUseOldPricing;
    lastPersistedUseAltPricing = newUseAltPricing;
    lastPersistedUseOldPricing = newUseOldPricing;
    updateAltPricingIndicator();
        
        runFullCalculation();
        alert('Settings saved successfully to the database!');
    } catch (e) {
        console.error("Could not save data to Firestore.", e);
        alert('Error: Could not save data to the database.');
    }
}

// Load coverage data from Firebase
async function loadCoverageData() {
    const coverageDocRef = firebase.firestore().collection('settings').doc('coverage');
    
    try {
        const doc = await coverageDocRef.get();
        if (doc.exists) {
            console.log("Coverage data loaded from Firestore.");
            coverageData = { ...defaultCoverageData, ...doc.data() };
        } else {
            console.log("No coverage document in Firestore, using default data.");
            coverageData = JSON.parse(JSON.stringify(defaultCoverageData));
        }
    } catch (e) {
        console.error("Could not load coverage data from Firestore, using default data.", e);
        coverageData = JSON.parse(JSON.stringify(defaultCoverageData));
    }
}

// Save coverage data to Firebase
async function saveCoverageData(newCoverageData) {
    const coverageDocRef = firebase.firestore().collection('settings').doc('coverage');
    
    try {
        await coverageDocRef.set(newCoverageData);
        coverageData = newCoverageData;
        console.log("Coverage data saved to Firestore successfully.");
        runFullCalculation(); // Recalculate with new coverage data
        alert('Coverage settings saved successfully to the database!');
        return true;
    } catch (e) {
        console.error("Could not save coverage data to Firestore.", e);
        alert('Error: Could not save coverage data to the database.');
        return false;
    }
}

    // Helper function to get the active pricing data
    function getActivePriceData() {
        if (useOldPricing) return oldPriceData;
        return useAltPricing ? altPriceData : priceData;
    }

    function getSplitterCascade(k) { if (k <= 1) return { d4: 0, d3: 0, d2: 0 }; const d4_dist = (k === 6) ? 0 : ((k % 4 === 1) ? Math.max(0, Math.floor(k / 4) - 1) : Math.floor(k / 4)); const d3_dist = Math.floor((k - 4 * d4_dist) / 3); const d2_dist = Math.ceil((k - 4 * d4_dist - 3 * d3_dist) / 2); const num_dist = d4_dist + d3_dist + d2_dist; return { d4: d4_dist + ((num_dist === 4) ? 1 : 0), d3: d3_dist + ((num_dist === 3) ? 1 : 0), d2: d2_dist + ((num_dist === 2) ? 1 : 0) }; }
    function getBaseCalculations(params, systemType) { const { B_SA, D_DA } = params; let service_coax = (B_SA * 30); if (systemType === 'QUATRA' || systemType === 'QUATRA_EVO' || systemType === 'QUATRA_100M') { service_coax = 0; } const coax_total = service_coax + (D_DA * 50); return { donor_lpda: 0, donor_wideband: D_DA, antenna_bracket: D_DA, coax_half: 0, coax_lmr400: coax_total, cherry_picker: 0, install_external: 0, travel_expenses: 0, }; }
    function activateEditMode(cell, key) { const displaySpan = cell.querySelector('.value-display'), inputField = cell.querySelector('.value-input'); displaySpan.classList.add('hidden'); inputField.classList.remove('hidden'); const currentValue = currentResults[key].override !== null ? currentResults[key].override : currentResults[key].calculated; inputField.value = currentValue; inputField.focus(); inputField.select(); }
    function deactivateEditMode(cell, key, save) { const displaySpan = cell.querySelector('.value-display'), inputField = cell.querySelector('.value-input'); if (save) { const newValue = parseFloat(inputField.value); if (!isNaN(newValue)) { currentResults[key].override = newValue; runFullCalculation(); } } else { inputField.classList.add('hidden'); displaySpan.classList.remove('hidden'); } }
    function updateCellDisplay(cell, key) { const item = currentResults[key], displaySpan = cell.querySelector('.value-display'), isOverridden = item.override !== null, value = isOverridden ? item.override : item.calculated; displaySpan.textContent = `${value.toFixed(item.decimals || 0)}`; displaySpan.classList.toggle('overridden', isOverridden); }
    function activateUnitSellEditMode(cell, key) { const item = currentResults[key]; if (!item) return; const displaySpan = cell.querySelector('.value-display'), inputField = cell.querySelector('.value-input'); displaySpan.classList.add('hidden'); inputField.classList.remove('hidden'); const currentValue = item.unitSellOverride !== null ? item.unitSellOverride : (item.calculatedUnitSell || 0); inputField.value = currentValue.toFixed(2); inputField.focus(); inputField.select(); }
    function deactivateUnitSellEditMode(cell, key, save) { const displaySpan = cell.querySelector('.value-display'), inputField = cell.querySelector('.value-input'); if (save) { const newValue = parseFloat(inputField.value); if (!isNaN(newValue)) { if (!currentResults[key]) currentResults[key] = { calculated: 0, override: null, decimals: 0, unit: '', unitSellOverride: null, calculatedUnitSell: 0 }; currentResults[key].unitSellOverride = newValue; runFullCalculation(); } } else { inputField.classList.add('hidden'); displaySpan.classList.remove('hidden'); } }
    function updateUnitSellCellDisplay(cell, key) { const item = currentResults[key]; if (!item) { cell.querySelector('.value-display').textContent = '£0.00'; return; } const displaySpan = cell.querySelector('.value-display'), isOverridden = item.unitSellOverride !== null && item.unitSellOverride !== undefined, value = isOverridden ? item.unitSellOverride : (item.calculatedUnitSell || 0); displaySpan.textContent = `£${value.toFixed(2)}`; displaySpan.classList.toggle('overridden', isOverridden); }
    
   function calculateCoverageRequirements() {
    console.log('calculateCoverageRequirements called');
    
    // --- Define variables first ---
    const systemType = document.getElementById('system-type').value;
    const quatraConfigForCoverage = QUATRA_VARIANT_CONFIGS[systemType] || null;
    const floorArea = parseFloat(document.getElementById('floor-area').value) || 0;
    const unit = document.querySelector('input[name="unit-switch"]:checked').value;
    const band = document.querySelector('input[name="band-switch"]:checked').value;
    const isQuatraWithHighCeiling = !!(quatraConfigForCoverage && !quatraConfigForCoverage.isDas);
    const isHighCeiling = document.getElementById('high-ceiling-warehouse').checked;
    
    console.log('System type:', systemType, 'Is Quatra with High Ceiling:', isQuatraWithHighCeiling, 'Is High Ceiling:', isHighCeiling);
    
    // --- This new block clears previous overrides ---
    if (!isApplyingShareState) {
        if (currentResults['service_antennas']) {
            currentResults['service_antennas'].override = null;
        }
        if (currentResults['QUATRA_CU']) {
            currentResults['QUATRA_CU'].override = null;
        }
        if (currentResults['QUATRA_EVO_CU']) {
            currentResults['QUATRA_EVO_CU'].override = null;
        }
        if (currentResults['QUATRA_100M_CU']) {
            currentResults['QUATRA_100M_CU'].override = null;
        }
    }
    // --- End of new block ---

    const pOpen = parseFloat(document.getElementById('percent-open').value) || 0;
    const pCubical = parseFloat(document.getElementById('percent-cubical').value) || 0;
    const pHollow = parseFloat(document.getElementById('percent-hollow').value) || 0;
    const pSolid = parseFloat(document.getElementById('percent-solid').value) || 0;
    const sum = pOpen + pCubical + pHollow + pSolid;
    const sumSpan = document.getElementById('percentage-sum');
    
    // Update percentage display based on high ceiling mode
    if (isQuatraWithHighCeiling && isHighCeiling) {
        sumSpan.textContent = `100% (High Ceiling Mode)`;
        sumSpan.style.color = '#004696';
        sumSpan.style.fontWeight = 'bold';
    } else {
        sumSpan.textContent = `${sum.toFixed(0)}%`;
        sumSpan.style.color = (sum.toFixed(0) === "100") ? 'green' : 'red';
        sumSpan.style.fontWeight = 'normal';
    }

    const usesPassiveAntennas = systemType.includes('DAS') || systemType.includes('G4');
    const dataSource = usesPassiveAntennas ? coverageData.go : coverageData.quatra;

    const coverage = dataSource[band]?.[unit];
    let unitsForArea = 0;
    
    // Calculate and display weighted average antenna radius
    const radiusElement = document.getElementById('average-radius');
    if (!radiusElement) {
        console.log('average-radius element not found');
        return;
    }
    
    if (coverage) {
        const calculateRadius = (area) => Math.sqrt(area / Math.PI);
        const unitSuffix = unit === 'sqm' ? 'm' : 'ft';
        
        const totalPercent = pOpen + pCubical + pHollow + pSolid;
        let averageRadius = 0;
        
        console.log('Coverage data:', coverage);
        console.log('Percentages:', { pOpen, pCubical, pHollow, pSolid, totalPercent });
        
        if (totalPercent > 0) {
            if (isQuatraWithHighCeiling && isHighCeiling && coverage.open_high_ceiling) {
                // Use only high ceiling radius when high ceiling mode is active
                const highCeilingRadius = calculateRadius(coverage.open_high_ceiling);
                averageRadius = highCeilingRadius;
                console.log('Using high ceiling radius:', averageRadius, unitSuffix);
                radiusElement.textContent = `${averageRadius.toFixed(1)}${unitSuffix} (High Ceiling)`;
                radiusElement.style.fontWeight = 'bold';
                radiusElement.style.color = '#004696';
            } else {
                averageRadius = ((pOpen / totalPercent) * calculateRadius(coverage.open)) +
                               ((pCubical / totalPercent) * calculateRadius(coverage.cubical)) +
                               ((pHollow / totalPercent) * calculateRadius(coverage.hollow)) +
                               ((pSolid / totalPercent) * calculateRadius(coverage.solid));
                console.log('Calculated average radius:', averageRadius, unitSuffix);
                radiusElement.textContent = `${averageRadius.toFixed(1)}${unitSuffix}`;
                radiusElement.style.fontWeight = 'bold';
                radiusElement.style.color = '#004696';
            }
        } else {
            radiusElement.textContent = '-';
        }
    } else {
        console.log('No coverage data available');
        radiusElement.textContent = 'No data';
    }

    if (floorArea > 0 && coverage) {
        if (isQuatraWithHighCeiling && isHighCeiling && !usesPassiveAntennas) {
            unitsForArea = floorArea / coverage.open_high_ceiling;
        } else {
            const percentages = { open: pOpen, cubical: pCubical, hollow: pHollow, solid: pSolid };
            unitsForArea = ((floorArea * (percentages.open / 100)) / coverage.open) +
                           ((floorArea * (percentages.cubical / 100)) / coverage.cubical) +
                           ((floorArea * (percentages.hollow / 100)) / coverage.hollow) +
                           ((floorArea * (percentages.solid / 100)) / coverage.solid);
        }
    }

    let totalRequiredUnits;
    const isNonDasQuatra = !!(quatraConfigForCoverage && !quatraConfigForCoverage.isDas);
    if (isNonDasQuatra) {
        const numberOfFloors = parseInt(document.getElementById('number-of-floors').value) || 1;
        const roundedUpUnitsPerFloor = Math.ceil(unitsForArea);
        totalRequiredUnits = roundedUpUnitsPerFloor * numberOfFloors;
    } else {
        totalRequiredUnits = Math.ceil(unitsForArea);
    }
    
    document.getElementById('total-service-antennas').value = totalRequiredUnits;
    runFullCalculation();
}
    
function runFullCalculation() {
    try {
        if (!isDataInitialized) {
            const resultsBody = document.getElementById('results-tbody');
            if (resultsBody) {
                resultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #57708A;">Loading data…</td></tr>`;
            }
            return;
        }
        // --- THIS BLOCK IS UPDATED TO CONTROL VISIBILITY ---
        const includeSurvey = document.getElementById('include-survey-checkbox').checked;
        if (!currentResults['survey_price_item']) {
            currentResults['survey_price_item'] = { calculated: 0, override: null, decimals: 2 };
        }
        const activePricingData = getActivePriceData();
        if (activePricingData['survey_price_item']) {
            if (includeSurvey) {
                const surveyPrice = parseFloat(document.getElementById('survey-price').value) || 0;
                activePricingData['survey_price_item'].cost = surveyPrice;
                currentResults['survey_price_item'].calculated = 1; // Set quantity to 1 to show the row
            } else {
                activePricingData['survey_price_item'].cost = 0;
                currentResults['survey_price_item'].calculated = 0; // Set quantity to 0 to hide the row
            }
        }
        // --- END OF UPDATE ---

        const systemType = document.getElementById('system-type').value;
        const networksInput = document.getElementById('number-of-networks');
        enforceNetworkSelectionForSystem(systemType);
        if (systemType.includes('EVO') && parseInt(networksInput.value) > 2) { networksInput.value = '2'; }

        const baseServiceAntennaInput = parseInt(document.getElementById('total-service-antennas').value, 10) || 0;
        let serviceAntennaCount = baseServiceAntennaInput;
        const quatraConfig = QUATRA_VARIANT_CONFIGS[systemType] || null;
        let preserveDisplayedServiceAntennas = false;

        if (quatraConfig) {
            const cuEntry = currentResults[quatraConfig.cuKey];
            if (cuEntry && cuEntry.override !== null && !Number.isNaN(cuEntry.override)) {
                const cuOverride = Number(cuEntry.override);
                if (quatraConfig.isDas) {
                    preserveDisplayedServiceAntennas = true;
                } else {
                    serviceAntennaCount = cuOverride;
                }
            }
        }

        if (currentResults['service_antennas'] && currentResults['service_antennas'].override !== null) {
            serviceAntennaCount = currentResults['service_antennas'].override;
            preserveDisplayedServiceAntennas = false;
        }

        let donorAntennaCount = (parseInt(networksInput.value) || 0) > 1 ? 2 : (parseInt(networksInput.value) || 0);
        if (currentResults['donor_wideband'] && currentResults['donor_wideband'].override !== null) {
            donorAntennaCount = currentResults['donor_wideband'].override;
        } else if (currentResults['donor_lpda'] && currentResults['donor_lpda'].override !== null) {
            donorAntennaCount = currentResults['donor_lpda'].override;
        }

        const params = {
            B_SA: serviceAntennaCount,
            C_Net: parseInt(networksInput.value) || 0,
            E_Max: parseInt(document.getElementById('max-antennas').value) || 0,
        };
        params.D_DA = donorAntennaCount;

        const calculatedValues = systemCalculators[systemType](params);
        for (const key in currentResults) { 
            if(key !== 'survey_price_item') currentResults[key].calculated = 0; 
        }
        for (const key in calculatedValues) {
            if (currentResults[key]) {
                currentResults[key].calculated = calculatedValues[key];
            } else {
                currentResults[key] = { calculated: calculatedValues[key], override: null, decimals: 0, unit: { coax_half: ' (m)', coax_lmr400: ' (m)', cable_cat: ' (m)', install_internal: ' (Days)', install_external: ' (Days)' }[key] || '', unitSellOverride: null, calculatedUnitSell: 0 };
            }
        }
    if(!currentResults['service_antennas']) { currentResults['service_antennas'] = { calculated: 0, override: null, decimals: 0, unit: '', unitSellOverride: null, calculatedUnitSell: 0 }; }
    currentResults['service_antennas'].calculated = preserveDisplayedServiceAntennas ? baseServiceAntennaInput : params.B_SA;
        if (quatraConfig) {
            const cuEntry = currentResults[quatraConfig.cuKey];
            if (cuEntry) {
                const effectiveCuCount = Number(cuEntry.override ?? cuEntry.calculated ?? 0);
                if (Number.isFinite(effectiveCuCount)) {
                    const normalizedCuCount = Math.max(0, effectiveCuCount);
                    if (currentResults['cable_cat']) {
                        currentResults['cable_cat'].calculated = normalizedCuCount * (quatraConfig.catLengthPerCu || 0);
                    }
                    if (currentResults['connectors_rg45']) {
                        currentResults['connectors_rg45'].calculated = normalizedCuCount * (quatraConfig.connectorsPerCu || 0);
                    }
                    if (currentResults['cable_fibre'] && quatraConfig.fibrePerCu !== undefined) {
                        currentResults['cable_fibre'].calculated = normalizedCuCount * (quatraConfig.fibrePerCu || 0);
                    }
                    if (currentResults['adapters_sfp'] && quatraConfig.sfpPerCu !== undefined) {
                        currentResults['adapters_sfp'].calculated = normalizedCuCount * (quatraConfig.sfpPerCu || 0);
                    }
                    if (currentResults['connectors'] && (quatraConfig.nTypeConnectorsPerCu !== undefined || quatraConfig.nTypeConnectorsPerDonor !== undefined)) {
                        const connectorsEntry = currentResults['connectors'];
                        const baseConnectorCalc = Number(calculatedValues['connectors'] ?? connectorsEntry.calculated ?? 0);
                        const baseCuCount = Math.max(0, Number(calculatedValues[quatraConfig.cuKey] ?? 0));
                        const connectorsPerCu = quatraConfig.nTypeConnectorsPerCu || 0;
                        const connectorsPerDonor = quatraConfig.nTypeConnectorsPerDonor || 0;
                        const donorCount = Math.max(0, Number(params.D_DA || 0));
                        const baseWithoutCuDonor = Math.max(0, baseConnectorCalc - (baseCuCount * connectorsPerCu) - (donorCount * connectorsPerDonor));
                        const adjustedConnectors = baseWithoutCuDonor + (normalizedCuCount * connectorsPerCu) + (donorCount * connectorsPerDonor);
                        connectorsEntry.calculated = Math.max(0, adjustedConnectors);
                    }

                    const nuEntry = currentResults[quatraConfig.nuKey];
                    const effectiveNuCount = Math.max(0, Number(nuEntry?.override ?? nuEntry?.calculated ?? 0));
                    if (!currentResults['adapters_n']) {
                        currentResults['adapters_n'] = { calculated: 0, override: null, decimals: 0, unit: '' };
                    }
                    const adapterCount = quatraConfig.adaptersCalculator(
                        effectiveNuCount,
                        normalizedCuCount,
                        params.C_Net || 0
                    );
                    currentResults['adapters_n'].calculated = Math.max(0, Number.isFinite(adapterCount) ? adapterCount : 0);

                    if (quatraConfig.isDas && quatraConfig.hubKey) {
                        const fullNuSets = Math.floor(normalizedCuCount / 12);
                        const remainingCus = normalizedCuCount % 12;
                        const derivedNuCount = fullNuSets + (remainingCus > 0 ? 1 : 0);
                        const derivedHubCount = fullNuSets + (remainingCus > 6 ? 1 : 0);

                        if (!currentResults[quatraConfig.nuKey]) {
                            currentResults[quatraConfig.nuKey] = { calculated: 0, override: null, decimals: 0, unit: '' };
                        }
                        currentResults[quatraConfig.nuKey].calculated = derivedNuCount;

                        if (!currentResults[quatraConfig.hubKey]) {
                            currentResults[quatraConfig.hubKey] = { calculated: 0, override: null, decimals: 0, unit: '' };
                        }
                        currentResults[quatraConfig.hubKey].calculated = derivedHubCount;

                        const dasAdapterCount = quatraConfig.adaptersCalculator(
                            derivedNuCount,
                            normalizedCuCount,
                            params.C_Net || 0
                        );
                        currentResults['adapters_n'].calculated = Math.max(0, Number.isFinite(dasAdapterCount) ? dasAdapterCount : 0);

                        const baseBsaTerm = (serviceAntennaCount || 0) / 3;
                        const donorTerm = (donorAntennaCount || 0) / 2;
                        const cuTerm = normalizedCuCount / 2;
                        const nuTerm = derivedNuCount / 7;
                        const derivedInstallDays = Math.ceil(baseBsaTerm + cuTerm + donorTerm + nuTerm + 1);

                        if (!currentResults['install_internal']) {
                            currentResults['install_internal'] = { calculated: 0, override: null, decimals: 0, unit: ' (Days)' };
                        }
                        currentResults['install_internal'].calculated = derivedInstallDays;
                    }
                }
            }
        }
        const internal_days = currentResults['install_internal']?.override ?? currentResults['install_internal']?.calculated ?? 0;
        if(currentResults['travel_expenses']) { currentResults['travel_expenses'].calculated = internal_days; } else { currentResults['travel_expenses'] = { calculated: internal_days, override: null, decimals: 0, unit: ' (Days)'}; }
        
        let totalHardwareSellPrice = 0, totalHardwareUnits = 0;
    const hardwareKeys = ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB', 'QUATRA_100M_NU', 'QUATRA_100M_CU', 'QUATRA_100M_PU', 'extender_cat6', 'extender_fibre_cu', 'extender_fibre_nu'];
        for (const key of hardwareKeys) {
            if (currentResults[key]) {
                const quantity = currentResults[key].override ?? currentResults[key].calculated;
                if (quantity > 0) {
                    totalHardwareUnits += quantity;
                    const priceInfo = priceData[key];
                    totalHardwareSellPrice += quantity * priceInfo.cost * (1 + priceInfo.margin);
                }
            }
        }

        let supportCost = 0;
        const activeButton = document.querySelector('.support-presets-main button.active-preset');
        
        if (activeButton && activeButton.id !== 'support-preset-none') {
            const tier = activeButton.id.replace('support-preset-', '');
            supportCost = getSpecificSupportCost(tier, totalHardwareUnits, totalHardwareSellPrice);
        } else {
            supportCost = calculateSupportCost(totalHardwareUnits, totalHardwareSellPrice);
        }
        
        if(!currentResults['support_package']) { 
            currentResults['support_package'] = { calculated: 0, override: null, decimals: 2, unit: ''}; 
        }
        
        currentResults['support_package'].calculated = supportCost;
        const activePricing = getActivePriceData();
        activePricing['support_package'].cost = supportCost;
        
        if (supportCost > 0) {
            if (activeButton && activeButton.id !== 'support-preset-none') {
                const tier = activeButton.id.replace('support-preset-', '');
                const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
                activePricing['support_package'].label = `Annual ${tierName} Support Package`;
            } else {
                activePricing['support_package'].label = "Annual Support Package";
            }
        } else {
            activePricing['support_package'].label = "Annual Support Package";
        }

        updateDOM();
        updateAllSupportTierPrices();
        updateSupportTableSummaries();
    } catch (error) {
        console.error("A critical error occurred during calculation:", error);
        const resultsBody = document.getElementById('results-tbody');
        if (resultsBody) {
            const message = isDataInitialized
                ? 'An error occurred. Please refresh and try again.'
                : 'Loading data…';
            const color = isDataInitialized ? 'red' : '#57708A';
            resultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: ${color};">${message}</td></tr>`;
        }
    }
}
    
function updateDOM() {
    const systemType = document.getElementById('system-type').value;
    const excludeHardware = document.getElementById('no-hardware-checkbox').checked;
    const referralPercent = parseFloat(document.getElementById('referral-fee-percent').value) || 0;
    const referralDecimal = referralPercent / 100;
    const uplift = (referralDecimal > 0 && referralDecimal < 1) ? 1 / (1 - referralDecimal) : 1;
    
    const systemTypeSelect = document.getElementById('system-type');
    const solutionName = systemTypeSelect.options[systemTypeSelect.selectedIndex].text;
    document.getElementById('solution-type-display').textContent = solutionName;

    document.getElementById('max-antennas-group').style.display = ['QUATRA', 'QUATRA_EVO'].includes(systemType) ? 'none' : 'flex';
    document.getElementById('high-ceiling-checkbox-group').style.display = ['QUATRA', 'QUATRA_EVO'].includes(systemType) ? 'block' : 'none';
    const resultsHead = document.getElementById('results-thead'), resultsBody = document.getElementById('results-tbody');
    resultsBody.innerHTML = '';
    resultsHead.innerHTML = `<tr><th class="col-item">Item</th><th class="col-qty">Qty</th><th class="col-sell">Unit Sell</th><th class="col-total">Total Sell</th><th class="col-margin">Margin (£)</th></tr>`;
    
    const itemGroups = {
        hardware: ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB', 'QUATRA_100M_NU', 'QUATRA_100M_CU', 'QUATRA_100M_PU', 'extender_cat6', 'extender_fibre_cu', 'extender_fibre_nu'],
        consumables: ['service_antennas', 'donor_wideband', 'donor_lpda', 'antenna_bracket', 'hybrids_4x4', 'hybrids_2x2', 'splitters_4way', 'splitters_3way', 'splitters_2way', 'pigtails', 'coax_lmr400', 'coax_half', 'cable_cat', 'cable_fibre', 'connectors', 'connectors_rg45', 'adapters_sfp', 'adapters_n'],
        services: ['install_internal', 'install_external', 'cherry_picker', 'travel_expenses', 'support_package', 'survey_price_item']
};

    const componentRelevance = {
        all: ['service_antennas', 'donor_wideband', 'donor_lpda', 'antenna_bracket', 'splitters_4way', 'splitters_3way', 'splitters_2way', 'coax_lmr400', 'coax_half', 'connectors', 'install_internal', 'install_external', 'cherry_picker', 'travel_expenses', 'support_package'],
        go: ['hybrids_4x4', 'hybrids_2x2', 'pigtails'],
        quatra: ['cable_cat', 'cable_fibre', 'connectors_rg45', 'adapters_sfp', 'adapters_n', 'extender_cat6', 'extender_fibre_cu', 'extender_fibre_nu'],
        G41: ['G41'], G43: ['G43'],
        QUATRA: ['QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB'], QUATRA_DAS: ['QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB'],
        QUATRA_EVO: ['QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB'], QUATRA_EVO_DAS: ['QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB'],
    QUATRA_100M: ['QUATRA_100M_NU', 'QUATRA_100M_CU', 'QUATRA_100M_PU'],
    QUATRA_100M_DAS: ['QUATRA_100M_NU', 'QUATRA_100M_CU', 'QUATRA_100M_PU'],
    };

    let subTotals = { hardware: { cost: 0, sell: 0, margin: 0 }, consumables: { cost: 0, sell: 0, margin: 0 }, services: { cost: 0, sell: 0, margin: 0 } };

    for (const groupName in itemGroups) {
        let groupHTML = '';
        let itemsInGroupDisplayed = 0;

        itemGroups[groupName].forEach(key => {
            if (!currentResults[key]) currentResults[key] = { calculated: 0, override: null, decimals: 0, unit: '', unitSellOverride: null, calculatedUnitSell: 0 };
            const itemResult = currentResults[key];
            const activePricing = getActivePriceData();
            const priceInfo = activePricing[key] || { cost: 0, margin: 0, label: 'N/A' };
            
            const isSupport = key === 'support_package';
            const quantity = isSupport ? 1 : (itemResult.override !== null ? itemResult.override : itemResult.calculated);
            
            let isRelevant = true;
            if (groupName === 'hardware' || groupName === 'consumables') { isRelevant = false; if (componentRelevance.all.includes(key)) isRelevant = true; if (componentRelevance[systemType]?.includes(key)) isRelevant = true; if (systemType.includes('G4') && componentRelevance.go.includes(key)) isRelevant = true; if (systemType.includes('QUATRA') && componentRelevance.quatra.includes(key)) isRelevant = true; }
            // Only show support package if a tier (Bronze, Silver, Gold) is selected
            if (isSupport) {
                const activeBtn = document.querySelector('.support-presets-main button.active-preset');
                const hasTierSelected = activeBtn && activeBtn.id !== 'support-preset-none';
                if (!hasTierSelected) isRelevant = false;
            }

            if (isRelevant && (quantity > 0 || showZeroQuantityItems)) {
                itemsInGroupDisplayed++;

                const finalCost = parseFloat(priceInfo.cost) || 0;
                const margin = parseFloat(priceInfo.margin) || 0;
                const qty = parseFloat(quantity) || 0;
                const upliftVal = parseFloat(uplift) || 1;
                
                // Calculate the base unit sell price (before any override)
                const baseUnitSell = isSupport ? finalCost : (finalCost * (1 + margin) * upliftVal);
                
                // Store calculated unit sell and check for override
                itemResult.calculatedUnitSell = baseUnitSell;
                const effectiveUnitSell = itemResult.unitSellOverride !== null ? itemResult.unitSellOverride : baseUnitSell;
                
                // Calculate final total sell using effective unit sell
                const finalTotalSell = effectiveUnitSell * qty;
                const trueLineMargin = finalTotalSell - (finalCost * qty);
                const finalUnitSell = effectiveUnitSell;
                
                // Add to sub-totals, ensuring they are numbers
                subTotals[groupName].sell += isNaN(finalTotalSell) ? 0 : finalTotalSell;
                subTotals[groupName].cost += isNaN(finalCost * qty) ? 0 : (finalCost * qty);
                subTotals[groupName].margin += isNaN(trueLineMargin) ? 0 : trueLineMargin;

                const qtyDisplay = isSupport ? '1' : `<span class="value-display"></span><input type="number" step="any" class="value-input hidden" />`;
                const qtyClass = isSupport ? '' : 'item-qty';
                
                // Unit Sell is editable for non-support items
                const unitSellDisplay = isSupport ? `£${finalUnitSell.toFixed(2)}` : `<span class="value-display"></span><input type="number" step="0.01" class="value-input hidden" />`;
                const unitSellClass = isSupport ? '' : 'item-unit-sell';
                
                let totalSellDisplay = `£${finalTotalSell.toFixed(2)}`;
                let totalSellClass = '';
                if (isSupport) {
                    totalSellClass = 'price-override item-qty'; // Re-use item-qty class for event handling
                    totalSellDisplay = `<span class="value-display"></span><input type="number" step="any" class="value-input hidden" />`;
                }

                groupHTML += `<tr>
                    <td class="col-item item-name">${priceInfo.label}${itemResult.unit || ''}</td>
                    <td class="col-qty ${qtyClass}" data-key="${key}">${qtyDisplay}</td>
                    <td class="col-sell ${unitSellClass}" data-key="${key}">${unitSellDisplay}</td>
                    <td class="col-total ${totalSellClass}" data-key="${key}">${totalSellDisplay}</td>
                    <td class="col-margin">£${trueLineMargin.toFixed(2)}</td>
                </tr>`;
            }
        });

        if (itemsInGroupDisplayed > 0) {
            const groupLabel = groupName.charAt(0).toUpperCase() + groupName.slice(1);
            resultsBody.innerHTML += `<tr class="group-header"><td colspan="5">${groupLabel}</td></tr>`;
            resultsBody.innerHTML += groupHTML;
            const finalGroupSell = (groupName === 'hardware' && excludeHardware) ? 0 : subTotals[groupName].sell;
            const finalGroupMargin = (groupName === 'hardware' && excludeHardware) ? 0 : subTotals[groupName].margin;
            resultsBody.innerHTML += `<tr class="summary-row"><td colspan="3" style="text-align: right;">${groupLabel} Sub-Total:</td><td style="text-align: right;">£${finalGroupSell.toFixed(2)}</td><td style="text-align: right;">£${finalGroupMargin.toFixed(2)}</td></tr>`;
        }
    }

    document.querySelectorAll('.item-qty').forEach(cell => {
        const key = cell.dataset.key;
        updateCellDisplay(cell, key);
        cell.addEventListener('click', () => activateEditMode(cell, key));
        const inputField = cell.querySelector('.value-input');
        inputField.addEventListener('click', (e) => e.stopPropagation());
        inputField.addEventListener('blur', () => deactivateEditMode(cell, key, true));
        inputField.addEventListener('keydown', e => {
            if (e.key === 'Enter') deactivateEditMode(cell, key, true);
            else if (e.key === 'Escape') deactivateEditMode(cell, key, false);
        });
    });

    document.querySelectorAll('.item-unit-sell').forEach(cell => {
        const key = cell.dataset.key;
        updateUnitSellCellDisplay(cell, key);
        cell.addEventListener('click', () => activateUnitSellEditMode(cell, key));
        const inputField = cell.querySelector('.value-input');
        inputField.addEventListener('click', (e) => e.stopPropagation());
        inputField.addEventListener('blur', () => deactivateUnitSellEditMode(cell, key, true));
        inputField.addEventListener('keydown', e => {
            if (e.key === 'Enter') deactivateUnitSellEditMode(cell, key, true);
            else if (e.key === 'Escape') deactivateUnitSellEditMode(cell, key, false);
        });
    });
    
    // Adjust subtotal for excluded hardware
    if (excludeHardware) {
        subTotals.hardware = { cost: 0, sell: 0, margin: 0 };
    }

    calculateAndDisplayGrandTotals(subTotals);
    subTotalsForProposal = subTotals;
}

    function calculateAndDisplayGrandTotals(subTotals) {
        const totalSell = (subTotals.hardware?.sell || 0) + (subTotals.consumables?.sell || 0) + (subTotals.services?.sell || 0);
        const totalCost = (subTotals.hardware?.cost || 0) + (subTotals.consumables?.cost || 0) + (subTotals.services?.cost || 0);
        const totalMargin = (subTotals.hardware?.margin || 0) + (subTotals.consumables?.margin || 0) + (subTotals.services?.margin || 0);
        const totalReferralFee = totalSell - totalCost - totalMargin;
        document.getElementById('total-cost').textContent = `£${totalCost.toFixed(2)}`;
        document.getElementById('total-sell').textContent = `£${totalSell.toFixed(2)}`;
        document.getElementById('total-margin-value').textContent = `£${totalMargin.toFixed(2)}`;
        document.getElementById('referral-fee-amount').textContent = `£${totalReferralFee.toFixed(2)}`;
    }

    function enforceNetworkSelectionForSystem(systemType) {
        const networksInput = document.getElementById('number-of-networks');
        if (!networksInput) {
            return;
        }
        const lockToSingleNetwork = systemType === 'QUATRA_100M' || systemType === 'QUATRA_100M_DAS';
        Array.from(networksInput.options).forEach(option => {
            option.disabled = lockToSingleNetwork ? option.value !== '1' : false;
        });
        if (lockToSingleNetwork && networksInput.value !== '1') {
            networksInput.value = '1';
        }
    }
    
    function toggleMultiFloorUI() {
    const systemType = document.getElementById('system-type').value;
    const quatraConfig = QUATRA_VARIANT_CONFIGS[systemType];
    const isNonDasQuatra = !!(quatraConfig && !quatraConfig.isDas);
        const floorsGroup = document.getElementById('number-of-floors-group');
        const areaLabel = document.getElementById('floor-area-label');
        if (isNonDasQuatra) { floorsGroup.style.display = 'flex'; areaLabel.textContent = 'Area per Floor'; } else { floorsGroup.style.display = 'none'; areaLabel.textContent = 'Floor Area'; }
    }
    
    // --- SUPPORT & MODAL FUNCTIONS ---
    function setSupportPreset(tier, isInitialLoad = false) {
        document.querySelectorAll('.support-presets-main button').forEach(b => b.classList.remove('active-preset'));
        const presetBtn = document.getElementById(`support-preset-${tier}`);
        if(presetBtn) presetBtn.classList.add('active-preset');
        // Store the active preset for calculations - don't modify config checkboxes
        window.activeSupportPreset = tier;
        // Only change maintenance value if user explicitly selects a preset, not on initial load
        if (!isInitialLoad) {
            document.getElementById('maintenance-percent').value = (tier === 'none') ? 0 : 5;
        }
        runFullCalculation();
    }
    function updateSupportTableSummaries() {
        const activePricing = getActivePriceData();
        if (!activePricing.install_internal) return; 
        const dailyInstallRate = activePricing.install_internal.cost * (1 + activePricing.install_internal.margin);
        
        // Calculate hardware units and sell price
        let totalHardwareUnits = 0, totalHardwareSellPrice = 0;
        const hardwareKeys = ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB', 'QUATRA_100M_NU', 'QUATRA_100M_CU', 'QUATRA_100M_PU', 'extender_cat6', 'extender_fibre_cu', 'extender_fibre_nu'];
        for (const key of hardwareKeys) {
            if (currentResults[key]) {
                const quantity = currentResults[key].override ?? currentResults[key].calculated;
                if (quantity > 0) {
                    totalHardwareUnits += quantity;
                    const priceInfo = activePricing[key];
                    if (priceInfo) totalHardwareSellPrice += quantity * priceInfo.cost * (1 + priceInfo.margin);
                }
            }
        }
        
        // Update hardware units display
        const unitsSpan = document.getElementById('hardware-units-count');
        if (unitsSpan) unitsSpan.textContent = totalHardwareUnits;
        
        const tierPerSystemDPY = { bronze: 0, silver: 0, gold: 0 };
        const tierFixedAnnualDPY = { bronze: 0, silver: 0, gold: 0 };
        for (const tier of ['bronze', 'silver', 'gold']) {
            document.querySelectorAll(`.support-checkbox[data-tier="${tier}"]:checked`).forEach(box => {
                const key = box.dataset.key;
                const dpmInput = document.querySelector(`.dpm-input[data-key="${key}"]`);
                if (dpmInput) {
                    const dpyValue = (parseFloat(dpmInput.value) || 0) * 12;
                    if (supportData[key].type === 'per_system') { tierPerSystemDPY[tier] += dpyValue; } else { tierFixedAnnualDPY[tier] += dpyValue; }
                }
            });
        }
        
        const maintenancePercent = parseFloat(document.getElementById('maintenance-percent').value) || 0;
        const maintenanceCost = totalHardwareSellPrice * (maintenancePercent / 100);
        
        // Update maintenance percent display in table
        const maintPercentDisplay = document.getElementById('maint-percent-display');
        if (maintPercentDisplay) maintPercentDisplay.textContent = maintenancePercent;
        
        for (const tier of ['bronze', 'silver', 'gold']) {
            const sysSummaryCell = document.getElementById(`${tier}-sys-summary`);
            const yearSummaryCell = document.getElementById(`${tier}-year-summary`);
            const maintSummaryCell = document.getElementById(`${tier}-maint-summary`);
            const totalSummaryCell = document.getElementById(`${tier}-total-summary`);
            
            const perSystemCost = tierPerSystemDPY[tier] * dailyInstallRate * totalHardwareUnits;
            const fixedServicesCost = tierFixedAnnualDPY[tier] * dailyInstallRate;
            const totalCost = perSystemCost + fixedServicesCost + maintenanceCost;
            
            if(sysSummaryCell) sysSummaryCell.textContent = `£${perSystemCost.toFixed(2)}`;
            if(yearSummaryCell) yearSummaryCell.textContent = `£${fixedServicesCost.toFixed(2)}`;
            if(maintSummaryCell) maintSummaryCell.textContent = `£${maintenanceCost.toFixed(2)}`;
            if(totalSummaryCell) totalSummaryCell.textContent = `£${totalCost.toFixed(2)}`;
        }
    }
   function getSpecificSupportCost(tier, totalHardwareUnits, totalHardwareSellPrice) {
    if (supportPriceOverrides[tier] !== null) {
        return parseFloat(supportPriceOverrides[tier]) || 0;
    }
    let totalPerSystemDPY = 0, totalFixedAnnualDPY = 0;
    const maintenancePercent = (tier === 'none') ? 0 : (parseFloat(document.getElementById('maintenance-percent').value) || 0);
    
    // Read current dpm values from input fields if they exist, otherwise use supportData
    for (const key in supportData) {
        if (key === 'maintenancePercent') continue; // Skip non-service keys
        if (supportData[key].tiers.includes(tier)) {
            const dpmInput = document.querySelector(`.dpm-input[data-key="${key}"]`);
            const dpmValue = dpmInput ? (parseFloat(dpmInput.value) || 0) : (parseFloat(supportData[key].dpm) || 0);
            const dpyValue = dpmValue * 12;
            if (supportData[key].type === 'per_system') totalPerSystemDPY += dpyValue;
            else totalFixedAnnualDPY += dpyValue;
        }
    }
    const activePricing = getActivePriceData();
    const dailyInstallRate = (parseFloat(activePricing.install_internal?.cost) * (1 + parseFloat(activePricing.install_internal?.margin))) || 0;
    const perSystemCost = (parseFloat(totalPerSystemDPY) || 0) * (parseFloat(dailyInstallRate) || 0) * (parseFloat(totalHardwareUnits) || 0);
    const fixedAnnualCost = (parseFloat(totalFixedAnnualDPY) || 0) * (parseFloat(dailyInstallRate) || 0);
    const maintenanceCost = (parseFloat(totalHardwareSellPrice) || 0) * (parseFloat(maintenancePercent) || 0) / 100;
    let result = (parseFloat(perSystemCost) || 0) + (parseFloat(fixedAnnualCost) || 0) + (parseFloat(maintenanceCost) || 0);
    
    // Special case: Single G43 Silver support gets 1.5x multiplier
    if (tier === 'silver') {
        const g43Qty = currentResults['G43'] ? (currentResults['G43'].override ?? currentResults['G43'].calculated) : 0;
        const systemType = document.getElementById('system-type')?.value;
        if (systemType === 'G43' && g43Qty === 1) {
            result = result * 1.5;
        }
    }
    
    return isNaN(result) ? 0 : result;
}
   function updateAllSupportTierPrices() {
    let totalHardwareSellPrice = 0, totalHardwareUnits = 0;
    const hardwareKeys = ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB', 'extender_cat6', 'extender_fibre_cu', 'extender_fibre_nu'];
    for (const key of hardwareKeys) {
        if (currentResults[key]) {
            const quantity = currentResults[key].override ?? currentResults[key].calculated;
            if (quantity > 0) {
                totalHardwareUnits += quantity;
                const activePricing = getActivePriceData();
                const priceInfo = activePricing[key];
                totalHardwareSellPrice += quantity * priceInfo.cost * (1 + priceInfo.margin);
            }
        }
    }

    ['bronze', 'silver', 'gold'].forEach(tier => {
        const calculatedCost = getSpecificSupportCost(tier, totalHardwareUnits, totalHardwareSellPrice);
        const displayPrice = supportPriceOverrides[tier] !== null ? supportPriceOverrides[tier] : calculatedCost;
        
        const container = document.querySelector(`.editable-price[data-tier="${tier}"]`);
        if(container) {
            const displaySpan = container.querySelector('.value-display');
            displaySpan.textContent = `£${displayPrice.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            displaySpan.style.fontStyle = supportPriceOverrides[tier] !== null ? 'italic' : 'normal';
            displaySpan.style.color = supportPriceOverrides[tier] !== null ? '#d9534f' : 'inherit';
        }
    });
}
    function calculateSupportCost(totalHardwareUnits, totalHardwareSellPrice) {
        let totalPerSystemDPY = 0, totalFixedAnnualDPY = 0;
        const selectedServices = document.querySelectorAll('.support-checkbox:checked');
        const maintenancePercent = parseFloat(document.getElementById('maintenance-percent').value) || 0;
        if (selectedServices.length === 0 && maintenancePercent === 0) return 0;
        selectedServices.forEach(box => {
            const key = box.dataset.key;
            const dpmInput = document.querySelector(`.dpm-input[data-key="${key}"]`);
            if (dpmInput) {
                const dpyValue = (parseFloat(dpmInput.value) || 0) * 12;
                if (supportData[key].type === 'per_system') totalPerSystemDPY += dpyValue;
                else totalFixedAnnualDPY += dpyValue;
            }
        });
        const dailyInstallRate = (priceData.install_internal?.cost * (1 + priceData.install_internal?.margin)) || 0;
        const perSystemCost = totalPerSystemDPY * dailyInstallRate * totalHardwareUnits;
        const fixedAnnualCost = totalFixedAnnualDPY * dailyInstallRate;
        const maintenanceCost = totalHardwareSellPrice * (maintenancePercent / 100);
        return perSystemCost + fixedAnnualCost + maintenanceCost;
    }
  function generateFilename() {
    const systemTypeSelect = document.getElementById('system-type');
    const solutionName = systemTypeSelect.options[systemTypeSelect.selectedIndex].text;
    const networks = document.getElementById('number-of-networks').value;
    const customerName = (document.getElementById('customer-name').value || 'Customer').substring(0, 50);

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleString('en-GB', { month: 'short' });
    const year = now.getFullYear();
    
    // Format: UCtel_Proposal_SOLUTION_#_Networks_for_CUSTOMER_DDMonYYYY
    const dateString = `${day}${month}${year}`;
    
    return `UCtel_Proposal_${solutionName}_${networks}_Networks_for_${customerName}_${dateString}`;
}
async function generateDocument() {
    const button = document.getElementById('generate-document-btn');
    const originalText = button ? button.innerHTML : null;

    if (!validateInputs(['customer-name', 'survey-price'])) {
        return; // Stop if validation fails
    }

    if (button) {
        button.innerHTML = 'Generating...';
        button.disabled = true;
    }

    try {
        const systemType = document.getElementById('system-type').value;
        const templateMap = {
            'G41': 'CEL-FI-GO-G41-Proposal-Template.docx',
            'G43': 'CEL-FI-GO-G43-Proposal-Template.docx',
            'QUATRA': 'CEL-FI-QUATRA-4000e-Proposal-Template.docx',
            'QUATRA_DAS': 'CEL-FI-QUATRA-4000e-Proposal-Template.docx',
            'QUATRA_EVO': 'CEL-FI-QUATRA-EVO-Proposal-Template.docx',
            'QUATRA_EVO_DAS': 'CEL-FI-QUATRA-EVO-Proposal-Template.docx',
            'QUATRA_100M': 'CEL-FI-QUATRA-4000e-Proposal-Template.docx',
            'QUATRA_100M_DAS': 'CEL-FI-QUATRA-4000e-Proposal-Template.docx'
        };
        const templateFilename = templateMap[systemType];
        if (!templateFilename) {
            throw new Error(`No template found for system type: ${systemType}`);
        }

        const response = await fetch(`./templates/${templateFilename}`);
        if (!response.ok) {
            throw new Error(`Could not fetch template: ${response.statusText}`);
        }
        const content = await response.arrayBuffer();

        const zip = new PizZip(content);
        const doc = new docxtemplater(zip);

        // This now uses the main helper function to get all the correct data and labels
        doc.render(getTemplateData());

        const out = doc.getZip().generate({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
        
        const filename = generateFilename() + '.docx';
        const link = document.createElement('a');
        link.href = URL.createObjectURL(out);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        if (button) {
            button.innerHTML = 'Downloaded! ✅';
        }

    } catch (error) {
        console.error('Error generating document:', error);
        alert('Could not generate the document. Please check the console for errors.');
        if (button) {
            button.innerHTML = 'Failed! ❌';
        }
    } finally {
        if (button) {
            setTimeout(() => {
                button.innerHTML = originalText ?? 'Proposal DOC 📄';
                button.disabled = false;
            }, 3000);
        }
    }
}
// In calculator.js, paste this entire function

// In calculator.js, replace the old function with this one

// In calculator.js, replace the entire function with this one

// In calculator.js, replace the entire function with this final version

function setupScreenshotButton() {
    const screenshotBtn = document.getElementById('screenshot-btn');
    const calculatorContainer = document.getElementById('main-container');

    if (!screenshotBtn || !calculatorContainer) {
        console.error("Screenshot button or container not found.");
        return;
    }

    screenshotBtn.addEventListener('click', () => {
        screenshotBtn.textContent = 'Capturing...';
        screenshotBtn.disabled = true;

        const options = {
            onclone: (documentClone) => {
                const headerToHide = documentClone.querySelector('.results-header');
                const containerClone = documentClone.getElementById('main-container');

                if (headerToHide) {
                    headerToHide.style.display = 'none';
                }

                if (containerClone) {
                    containerClone.style.width = 'fit-content';
                    containerClone.style.maxWidth = 'none';
                }
            }
        };

        html2canvas(calculatorContainer, options).then(canvas => {
            canvas.toBlob(blob => {
                navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]).then(() => {
                    screenshotBtn.textContent = 'Copied! ✅';
                }).catch(err => {
                    console.error('Failed to copy to clipboard:', err);
                    alert('Could not copy to clipboard. The image will be downloaded instead.');

                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = 'calculator-screenshot.png';
                    link.click();
                    link.remove();
                    screenshotBtn.textContent = 'Downloaded!';
                });
            }, 'image/png', 0.95);
        }).finally(() => {
            setTimeout(() => {
                screenshotBtn.textContent = 'Screenshot 📸';
                screenshotBtn.disabled = false;
            }, 3000);
        });
    });
}
    // --- NEW FEATURES (Make.com, Links, Validation) ---
 async function initialize() {
    // --- Load state from URL first ---
    const stateLoaded = loadStateFromURL();

    // --- Get DOM elements ---
    const mainContainer = document.getElementById('main-container');
    const viewToggleButton = document.getElementById('view-toggle-btn');

    const applyViewMode = (mode) => {
        if (!mainContainer || !viewToggleButton) {
            return;
        }

        if (mode === 'dashboard') {
            mainContainer.classList.add('screenshot-mode');
        } else {
            mainContainer.classList.remove('screenshot-mode');
        }

        viewToggleButton.textContent = mode === 'dashboard'
            ? 'Switch to Simple View'
            : 'Switch to Dashboard View';
    };

    let currentViewMode = initialViewMode || 'dashboard';
    applyViewMode(currentViewMode);

    // --- Attach all event listeners ---
    setupScreenshotButton();
    if (viewToggleButton) {
        viewToggleButton.addEventListener('click', () => {
            currentViewMode = currentViewMode === 'dashboard' ? 'simple' : 'dashboard';
            applyViewMode(currentViewMode);
        });
    }
    const generatePdfBtn = document.getElementById('generate-pdf-btn');
    if (generatePdfBtn) {
        generatePdfBtn.addEventListener('click', generatePdf);
    }
    const generateDocumentBtn = document.getElementById('generate-document-btn');
    if (generateDocumentBtn) {
        generateDocumentBtn.addEventListener('click', generateDocument);
    }
    document.getElementById('quote-to-monday-btn').addEventListener('click', () => sendDataToMake('quote'));
    document.getElementById('generate-link-btn').addEventListener('click', generateShareLink);
    document.getElementById('support-preset-none').addEventListener('click', () => setSupportPreset('none'));
    document.getElementById('support-preset-bronze').addEventListener('click', () => setSupportPreset('bronze'));
    document.getElementById('support-preset-silver').addEventListener('click', () => setSupportPreset('silver'));
    document.getElementById('support-preset-gold').addEventListener('click', () => setSupportPreset('gold'));
    const generateInteractiveLinkBtn = document.getElementById('generate-interactive-link-btn');
    if (generateInteractiveLinkBtn) {
        generateInteractiveLinkBtn.addEventListener('click', generateInteractiveLink);
    }
    const savePortalButton = document.getElementById('save-proposal-btn');
    if (savePortalButton) {
        savePortalButton.addEventListener('click', (event) => {
            event.preventDefault();
            saveProposalToPortal({ button: event.currentTarget, openAfterSave: false }).catch(() => {});
        });
    }

    const proposalTempBtn = document.getElementById('proposal-temp-btn');
    if (proposalTempBtn) {
        proposalTempBtn.addEventListener('click', (event) => {
            event.preventDefault();
            const portalUrl = `${PROPOSAL_APP_BASE_URL}/`;
            window.open(portalUrl, '_blank', 'noopener');
        });
    }

    const validatedFields = ['customer-name', 'survey-price', 'quote-number'];
    validatedFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if(field) { field.addEventListener('input', () => field.classList.remove('input-error')); }
    });

    document.querySelectorAll('#floor-area, input[name="unit-switch"], input[name="band-switch"], .wall-percent, #high-ceiling-warehouse, #number-of-floors').forEach(input => {
        input.addEventListener('input', calculateCoverageRequirements);
        input.addEventListener('change', calculateCoverageRequirements);
    });

    document.getElementById('system-type').addEventListener('change', () => {
        const systemType = document.getElementById('system-type').value;
        enforceNetworkSelectionForSystem(systemType);
        toggleMultiFloorUI();
        calculateCoverageRequirements();
    });

   document.querySelectorAll('#number-of-networks, #max-antennas, #no-hardware-checkbox, #referral-fee-percent, #maintenance-percent, #customer-name, #survey-price, #quote-number, #proposal-description, #total-service-antennas, #include-survey-checkbox').forEach(input => {
        input.addEventListener('input', runFullCalculation);
        input.addEventListener('change', runFullCalculation);
    });

    document.getElementById('reset-overrides').addEventListener('click', () => { for (const key in currentResults) { if (currentResults[key].hasOwnProperty('override')) currentResults[key].override = null; if (currentResults[key].hasOwnProperty('unitSellOverride')) currentResults[key].unitSellOverride = null; } setSupportPreset('none'); runFullCalculation(); });
    
    document.getElementById('reset-all-btn').addEventListener('click', () => {
        // Reset all overrides
        for (const key in currentResults) {
            if (currentResults[key].hasOwnProperty('override')) currentResults[key].override = null;
            if (currentResults[key].hasOwnProperty('unitSellOverride')) currentResults[key].unitSellOverride = null;
        }
        
        // Reset form inputs to defaults
        document.getElementById('floor-area').value = '1000';
        document.getElementById('number-of-floors').value = '1';
        document.getElementById('unit-sqm').checked = true;
        document.getElementById('band-high').checked = true;
        document.getElementById('percent-open').value = '30';
        document.getElementById('percent-cubical').value = '30';
        document.getElementById('percent-hollow').value = '30';
        document.getElementById('percent-solid').value = '10';
        document.getElementById('high-ceiling-warehouse').checked = false;
        document.getElementById('system-type').value = 'G41';
        document.getElementById('number-of-networks').value = '4';
        document.getElementById('max-antennas').value = '12';
        document.getElementById('no-hardware-checkbox').checked = false;
        document.getElementById('referral-fee-percent').value = '0';
        document.getElementById('maintenance-percent').value = '5';
        document.getElementById('customer-name').value = '';
        document.getElementById('survey-price').value = '';
        document.getElementById('quote-number').value = '';
        // Note: total-service-antennas is calculated automatically by runFullCalculation()
        
        const includeSurvey = document.getElementById('include-survey-checkbox');
        if (includeSurvey) includeSurvey.checked = false;
        
        const altPricingToggle = document.getElementById('alt-pricing-toggle');
        if (altPricingToggle) altPricingToggle.checked = false;
        useAltPricing = false;
        
        const oldPricingToggle = document.getElementById('old-pricing-toggle');
        if (oldPricingToggle) oldPricingToggle.checked = false;
        useOldPricing = false;
        
        const proposalDescription = document.getElementById('proposal-description');
        if (proposalDescription) proposalDescription.value = '';
        
        // Reset support package
        supportPriceOverrides = { bronze: null, silver: null, gold: null };
        setSupportPreset('none');
        updateAllSupportTierPrices();
        
        // Reset zero qty toggle
        showZeroQuantityItems = false;
        const toggleBtn = document.getElementById('toggle-zero-qty-btn');
        if (toggleBtn) toggleBtn.textContent = 'Show All Items';
        
        updateAltPricingIndicator();
        runFullCalculation();
    });
    
    document.getElementById('toggle-zero-qty-btn').addEventListener('click', (e) => { showZeroQuantityItems = !showZeroQuantityItems; e.target.textContent = showZeroQuantityItems ? 'Hide Zero Qty Items' : 'Show All Items'; runFullCalculation(); });

    const altPricingToggle = document.getElementById('alt-pricing-toggle');
    if (altPricingToggle) {
        altPricingToggle.addEventListener('change', (event) => {
            useAltPricing = event.target.checked;
            // Make Alt and Old mutually exclusive
            if (useAltPricing && useOldPricing) {
                useOldPricing = false;
                const oldToggle = document.getElementById('old-pricing-toggle');
                if (oldToggle) oldToggle.checked = false;
            }
            updateAltPricingIndicator();
            runFullCalculation();
            if (typeof window.__updateSettingsSaveState === 'function') {
                window.__updateSettingsSaveState();
            }
        });
    }

    const oldPricingToggle = document.getElementById('old-pricing-toggle');
    if (oldPricingToggle) {
        oldPricingToggle.addEventListener('change', (event) => {
            useOldPricing = event.target.checked;
            // Make Alt and Old mutually exclusive
            if (useOldPricing && useAltPricing) {
                useAltPricing = false;
                const altToggle = document.getElementById('alt-pricing-toggle');
                if (altToggle) altToggle.checked = false;
            }
            updateAltPricingIndicator();
            runFullCalculation();
            if (typeof window.__updateSettingsSaveState === 'function') {
                window.__updateSettingsSaveState();
            }
        });
    }

    // --- New listeners for editable support prices ---
    document.querySelectorAll('.editable-price').forEach(cell => {
        const tier = cell.dataset.tier;
        const displaySpan = cell.querySelector('.value-display');
        const inputField = cell.querySelector('.value-input');

        const activate = () => {
            displaySpan.classList.add('hidden');
            inputField.classList.remove('hidden');
            inputField.value = supportPriceOverrides[tier] !== null ? supportPriceOverrides[tier] : getSpecificSupportCost(tier, 0, 0); // Simplified calc for placeholder
            inputField.focus();
            inputField.select();
        };

        const deactivate = (save) => {
            if (save) {
                const newValue = parseFloat(inputField.value);
                if (!isNaN(newValue)) {
                    supportPriceOverrides[tier] = newValue;
                }
            }
            inputField.classList.add('hidden');
            displaySpan.classList.remove('hidden');
            runFullCalculation();
        };

        cell.addEventListener('click', activate);
        inputField.addEventListener('blur', () => deactivate(true));
        inputField.addEventListener('keydown', e => {
            if (e.key === 'Enter') deactivate(true);
            else if (e.key === 'Escape') deactivate(false);
        });
    });

    document.getElementById('reset-support-prices').addEventListener('click', () => {
        supportPriceOverrides = { bronze: null, silver: null, gold: null };
        runFullCalculation();
    });

    // --- Initial Setup ---
    const resultsBody = document.getElementById('results-tbody');
    if (resultsBody) {
        resultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #57708A;">Waiting for authentication…</td></tr>`;
    }

    try {
        await waitForPrimaryAuthUser();
    } catch (authError) {
        console.error('Unable to detect signed-in user before loading pricing data.', authError);
        if (resultsBody) {
            resultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #B94A48;">Sign in to load the latest pricing data.</td></tr>`;
        }
        return;
    }

    if (resultsBody) {
        resultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #57708A;">Loading data…</td></tr>`;
    }

    try {
        await loadPrices();
    } catch (pricingError) {
        console.error('Failed to load pricing data from Firestore.', pricingError);
        if (resultsBody) {
            resultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #B94A48;">Unable to load pricing data. Refresh after signing in.</td></tr>`;
        }
        alert('Unable to load pricing data from the datastore. Please make sure you are signed in and try again.');
        return;
    }

    await loadCoverageData(); // Load coverage data from database
    setupSettingsModal();
    populateSupportTable();
    toggleMultiFloorUI();
    enforceNetworkSelectionForSystem(document.getElementById('system-type').value);

    isDataInitialized = true;
    updateAltPricingIndicator();

    // --- Final Calculation Logic ---
    if (!stateLoaded) {
        setSupportPreset('none', true);
    }

    calculateCoverageRequirements(); 

    if (pendingShareOverrides && Object.keys(pendingShareOverrides).length > 0) {
        setTimeout(() => applyPendingShareOverrides(), 0);
    }

    if (!stateLoaded) {
        // Test the radius display after a short delay
        setTimeout(() => {
            const testElement = document.getElementById('average-radius');
            if (testElement) {
                console.log('Test: Found average-radius element, content:', testElement.textContent);
                // Force a calculation after everything is loaded
                calculateCoverageRequirements();
            } else {
                console.log('Test: average-radius element not found');
            }
        }, 500);
    }

    if (!initialViewMode) {
        initialViewMode = 'dashboard';
    }

    currentViewMode = initialViewMode;
    applyViewMode(currentViewMode);
    
    // Setup high ceiling warehouse functionality
    setupHighCeilingControls();

    updateAltPricingIndicator();
}

// Function to handle high ceiling warehouse controls
function setupHighCeilingControls() {
    const highCeilingCheckbox = document.getElementById('high-ceiling-warehouse');
    const wallPercentageGroup = document.querySelector('.percentage-group');
    const wallPercentInputs = document.querySelectorAll('.wall-percent');
    const highCeilingNotice = document.getElementById('high-ceiling-notice');
    
    function toggleWallPercentages() {
        const isHighCeiling = highCeilingCheckbox ? highCeilingCheckbox.checked : false;
    const systemType = document.getElementById('system-type').value;
    const systemConfig = QUATRA_VARIANT_CONFIGS[systemType];
    const isQuatraWithHighCeiling = !!(systemConfig && !systemConfig.isDas);
        
        // Only disable for specific QUATRA systems (not DAS) in high ceiling mode
        if (isQuatraWithHighCeiling && isHighCeiling) {
            wallPercentageGroup.classList.add('wall-percentages-disabled');
            wallPercentInputs.forEach(input => {
                input.disabled = true;
            });
            
            // Show notice
            if (highCeilingNotice) {
                highCeilingNotice.style.display = 'block';
            }
            
            // DO NOT change the wall percentage values - just disable the inputs
        } else {
            wallPercentageGroup.classList.remove('wall-percentages-disabled');
            wallPercentInputs.forEach(input => {
                input.disabled = false;
            });
            
            // Hide notice
            if (highCeilingNotice) {
                highCeilingNotice.style.display = 'none';
            }
            
            // DO NOT reset values when unchecking - keep user's values
        }
        
        // Recalculate coverage
        calculateCoverageRequirements();
    }
    
    // Add event listeners
    if (highCeilingCheckbox) {
        highCeilingCheckbox.addEventListener('change', toggleWallPercentages);
    }
    
    // Also listen to system type changes
    const systemTypeSelect = document.getElementById('system-type');
    if (systemTypeSelect) {
        systemTypeSelect.addEventListener('change', toggleWallPercentages);
    }
    
    // Initial check
    toggleWallPercentages();
}
    function validateInputs(fieldIds) {
    let isValid = true;
    fieldIds.forEach(id => {
        const field = document.getElementById(id);
        if (!field.value.trim()) {
            field.classList.add('input-error');
            isValid = false;
        } else {
            field.classList.remove('input-error');
        }
    });
    return isValid;
}
    async function sendDataToMake(dataType) {
    const buttonId = dataType === 'proposal' ? 'generate-proposal-btn' : 'quote-to-monday-btn';
    const button = document.getElementById(buttonId);
    const originalText = button.innerHTML;

    if (dataType === 'proposal') { if (!validateInputs(['customer-name', 'survey-price'])) return;
    } else if (dataType === 'quote') { if (!validateInputs(['quote-number'])) return; }

    button.innerHTML = 'Sending...';
    button.disabled = true;

    try {
        let totalHardwareSellPrice = 0, totalHardwareUnits = 0;
        const hardwareKeys = ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB', 'extender_cat6', 'extender_fibre_cu', 'extender_fibre_nu'];
        for (const key of hardwareKeys) { if (currentResults[key]) { const quantity = currentResults[key].override ?? currentResults[key].calculated; if (quantity > 0) { totalHardwareUnits += quantity; const priceInfo = priceData[key]; totalHardwareSellPrice += quantity * priceInfo.cost * (1 + priceInfo.margin); } } }
        
        let selectedSupportTier = 'none';
        let selectedSupportName = "Please see the support options below";
        const activeButton = document.querySelector('.support-presets-main button.active-preset');
        if (activeButton && activeButton.id !== 'support-preset-none') {
            selectedSupportTier = activeButton.id.replace('support-preset-', '');
            selectedSupportName = selectedSupportTier.charAt(0).toUpperCase() + selectedSupportTier.slice(1);
        }
        const selectedSupportCost = getSpecificSupportCost(selectedSupportTier, totalHardwareUnits, totalHardwareSellPrice);
        const servicesTotal = parseFloat(subTotalsForProposal.services?.sell || 0);
        const supportCost = parseFloat(selectedSupportCost || 0);
        
        // Debug the professional services calculation
        console.log('=== PROFESSIONAL SERVICES DEBUG ===');
        console.log('selectedSupportTier:', selectedSupportTier);
        console.log('subTotalsForProposal.services:', subTotalsForProposal.services);
        console.log('servicesTotal (parsed):', servicesTotal);
        console.log('selectedSupportCost (raw):', selectedSupportCost);
        console.log('supportCost (parsed):', supportCost);
        console.log('servicesTotal isNaN:', isNaN(servicesTotal));
        console.log('supportCost isNaN:', isNaN(supportCost));
        
        const professionalServicesCost = (isNaN(servicesTotal) ? 0 : servicesTotal) - (isNaN(supportCost) ? 0 : supportCost);
        console.log('professionalServicesCost result:', professionalServicesCost);
        console.log('professionalServicesCost isNaN:', isNaN(professionalServicesCost));
        
        // Ensure professionalServicesCost is never NaN
        const safeProfessionalServicesCost = isNaN(professionalServicesCost) ? 0 : professionalServicesCost;
        const bronzeCost = getSpecificSupportCost('bronze', totalHardwareUnits, totalHardwareSellPrice);
        const silverCost = getSpecificSupportCost('silver', totalHardwareUnits, totalHardwareSellPrice);
        const goldCost = getSpecificSupportCost('gold', totalHardwareUnits, totalHardwareSellPrice);
        const totalMargin = (subTotalsForProposal.hardware?.margin || 0) + (subTotalsForProposal.consumables?.margin || 0) + (subTotalsForProposal.services?.margin || 0);
        
        // Helper function to safely format numbers
        const safeFixed = (value, decimals = 2) => {
            const num = parseFloat(value);
            return isNaN(num) ? '0.00' : num.toFixed(decimals);
        };
        
        const systemTypeSelect = document.getElementById('system-type');
        const selectedValue = systemTypeSelect.value;
        const selectedText = systemTypeSelect.options[systemTypeSelect.selectedIndex].text;
        const solutionNameMap = {
            'G41': 'GO G41 DAS', 'G43': 'GO G43 DAS',
            'QUATRA': 'QUATRA 4000e Only', 'QUATRA_EVO': 'QUATRA EVO Only'
        };
        const solutionNameToSend = solutionNameMap[selectedValue] || selectedText;

        const dataToSend = {
            CustomerName: document.getElementById('customer-name').value,
            Solution: solutionNameToSend,
            NumberOfNetworks: document.getElementById('number-of-networks').value,
            SurveyPrice: safeFixed(parseFloat(document.getElementById('survey-price').value) || 0),
            Description1: "CEL-FI Hardware", Qty1: "1", UnitPrice1: safeFixed(subTotalsForProposal.hardware?.sell || 0), TotalPrice1: safeFixed(subTotalsForProposal.hardware?.sell || 0),
            Description2: "Antennas, cables and connectors", Qty2: "1", UnitPrice2: safeFixed(subTotalsForProposal.consumables?.sell || 0), TotalPrice2: safeFixed(subTotalsForProposal.consumables?.sell || 0),
            Description3: "Professional Services", Qty3: "1", UnitPrice3: safeFixed(safeProfessionalServicesCost), TotalPrice3: safeFixed(safeProfessionalServicesCost),
            Description4: selectedSupportTier !== 'none' ? selectedSupportName : "Please see the support options below",
            Qty4: selectedSupportTier !== 'none' ? "1" : "",
            UnitPrice4: selectedSupportTier !== 'none' ? safeFixed(selectedSupportCost) : "",
            TotalPrice4: selectedSupportTier !== 'none' ? safeFixed(selectedSupportCost) : "",
            Support1: "Bronze", SupportQty1: "1", SupportUnitPrice1: safeFixed(bronzeCost), SupportTotalPrice1: safeFixed(bronzeCost),
            Support2: "Silver", SupportQty2: "1", SupportUnitPrice2: safeFixed(silverCost), SupportTotalPrice2: safeFixed(silverCost),
            Support3: "Gold", SupportQty3: "1", SupportUnitPrice3: safeFixed(goldCost), SupportTotalPrice3: safeFixed(goldCost),
            MarginTotal: safeFixed(totalMargin),
            TotalMargin: safeFixed(totalMargin),
            QuoteNumber: dataType === 'quote' ? document.getElementById('quote-number').value : "",
        };

        // Debug logging - check for NaN values before sending
        console.log('=== WEBHOOK DEBUG DATA ===');
        console.log('professionalServicesCost (original):', professionalServicesCost);
        console.log('safeProfessionalServicesCost (safe):', safeProfessionalServicesCost);
        console.log('subTotalsForProposal.services:', subTotalsForProposal.services);
        console.log('selectedSupportCost:', selectedSupportCost);
        console.log('bronzeCost:', bronzeCost);
        console.log('silverCost:', silverCost);
        console.log('goldCost:', goldCost);
        console.log('Full dataToSend object:', JSON.stringify(dataToSend, null, 2));
        
        // Check for any NaN values in the data
        for (const [key, value] of Object.entries(dataToSend)) {
            if (typeof value === 'string' && (value === 'NaN' || value.includes('NaN'))) {
                console.error(`❌ Found NaN in ${key}:`, value);
            }
        }

        const response = await fetch(MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([dataToSend])
        });

        // Log the response for debugging
        console.log('Make.com Response Status:', response.status);
        console.log('Make.com Response Headers:', response.headers);
        
        const responseText = await response.text();
        console.log('Make.com Response Body:', responseText);

        if (response.ok) { 
            button.innerHTML = 'Sent! ✅'; 
        } else { 
            console.error('Make.com Error Response:', responseText);
            throw new Error(`Webhook failed: ${response.status} ${response.statusText} - ${responseText}`); 
        }
    } catch (error) {
        console.error(`Failed to send ${dataType}:`, error);
        alert(`Error: Could not send ${dataType} to Make.com. Check console for details.`);
        button.innerHTML = 'Failed! ❌';
    } finally {
        setTimeout(() => {
            button.innerHTML = originalText;
            button.disabled = false;
        }, 3000);
    }
}
    // Helper function to gather all data for templates
function getTemplateData() {
    // Calculate hardware totals for support calcs
    let totalHardwareSellPrice = 0,
        totalHardwareUnits = 0;
    const hardwareKeys = ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB', 'QUATRA_100M_NU', 'QUATRA_100M_CU', 'QUATRA_100M_PU'];
    hardwareKeys.forEach(key => {
        if (currentResults[key]) {
            const quantity = currentResults[key].override ?? currentResults[key].calculated;
            if (quantity > 0) {
                totalHardwareUnits += quantity;
                totalHardwareSellPrice += quantity * priceData[key].cost * (1 + priceData[key].margin);
            }
        }
    });

    // --- CORRECTED LOGIC FOR PROPOSAL ---

    // 1. Get the cost and label for the selected support package.
    const selectedSupportCost = priceData['support_package']?.cost || 0;
    const selectedSupportName = selectedSupportCost > 0 ? (priceData['support_package']?.label || "Annual Support Package") : "Please see the support options below";

    // 2. "Professional Services" is the total of all other services.
    const servicesTotal = parseFloat(subTotalsForProposal.services?.sell || 0);
    const supportCost = parseFloat(selectedSupportCost || 0);
    const professionalServicesCost = (isNaN(servicesTotal) ? 0 : servicesTotal) - (isNaN(supportCost) ? 0 : supportCost);
    
    // Get other details
    const systemTypeSelect = document.getElementById('system-type');
    const solutionName = systemTypeSelect.options[systemTypeSelect.selectedIndex].text;
    
    // Return final data object matching placeholders
    return {
        Account: document.getElementById('customer-name').value,
        Description: document.getElementById('proposal-description').value,
        Solution: solutionName,
        NumberOfNetworks: document.getElementById('number-of-networks').value,
        SurveyPrice: `£${(parseFloat(document.getElementById('survey-price').value) || 0).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        
        Description1: "CEL-FI Hardware",
        Qty1: "1",
        UnitPrice1: `£${(subTotalsForProposal.hardware?.sell || 0).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        TotalPrice1: `£${(subTotalsForProposal.hardware?.sell || 0).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,

        Description2: "Antennas, cables and connectors",
        Qty2: "1",
        UnitPrice2: `£${(subTotalsForProposal.consumables?.sell || 0).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        TotalPrice2: `£${(subTotalsForProposal.consumables?.sell || 0).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        
        Description3: "Installation Services",
        Qty3: "1",
        UnitPrice3: `£${professionalServicesCost.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        TotalPrice3: `£${professionalServicesCost.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        
        Description4: selectedSupportName,
        Qty4: selectedSupportCost > 0 ? "1" : "",
        UnitPrice4: selectedSupportCost > 0 ? `£${selectedSupportCost.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "",
        TotalPrice4: selectedSupportCost > 0 ? `£${selectedSupportCost.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "",

        TotalPrice: `£${((subTotalsForProposal.hardware?.sell || 0) + (subTotalsForProposal.consumables?.sell || 0) + (subTotalsForProposal.services?.sell || 0)).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,

        Support1: "Bronze",
        SupportQty1: "1",
        SupportUnitPrice1: `£${getSpecificSupportCost('bronze', totalHardwareUnits, totalHardwareSellPrice).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        SupportTotalPrice1: `£${getSpecificSupportCost('bronze', totalHardwareUnits, totalHardwareSellPrice).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        
        Support2: "Silver",
        SupportQty2: "1",
        SupportUnitPrice2: `£${getSpecificSupportCost('silver', totalHardwareUnits, totalHardwareSellPrice).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        SupportTotalPrice2: `£${getSpecificSupportCost('silver', totalHardwareUnits, totalHardwareSellPrice).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        
        Support3: "Gold",
        SupportQty3: "1",
        SupportUnitPrice3: `£${getSpecificSupportCost('gold', totalHardwareUnits, totalHardwareSellPrice).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
        SupportTotalPrice3: `£${getSpecificSupportCost('gold', totalHardwareUnits, totalHardwareSellPrice).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
    };
}
async function generatePdf() {
    const button = document.getElementById('generate-pdf-btn');
    const originalText = button ? button.innerHTML : null;
    if (!validateInputs(['customer-name', 'survey-price'])) return;

    if (button) {
        button.innerHTML = 'Preparing...';
        button.disabled = true;
    }

    try {
        // 1. Get the correct DOCX template
        const systemType = document.getElementById('system-type').value;
        const docxTemplateMap = {
            'G41': 'CEL-FI-GO-G41-Proposal-Template.docx',
            'G43': 'CEL-FI-GO-G43-Proposal-Template.docx',
            'QUATRA': 'CEL-FI-QUATRA-4000e-Proposal-Template.docx',
            'QUATRA_DAS': 'CEL-FI-QUATRA-4000e-Proposal-Template.docx',
            'QUATRA_EVO': 'CEL-FI-QUATRA-EVO-Proposal-Template.docx',
            'QUATRA_EVO_DAS': 'CEL-FI-QUATRA-EVO-Proposal-Template.docx',
            'QUATRA_100M': 'CEL-FI-QUATRA-4000e-Proposal-Template.docx',
            'QUATRA_100M_DAS': 'CEL-FI-QUATRA-4000e-Proposal-Template.docx'
        };
        const templateFilename = docxTemplateMap[systemType];
        if (!templateFilename) throw new Error(`No template found for system type: ${systemType}`);

        // 2. Fetch the template and populate it with data
        const response = await fetch(`templates/${templateFilename}`);
        if (!response.ok) throw new Error(`Could not fetch template: ${response.statusText}`);
        const content = await response.arrayBuffer();
        const zip = new PizZip(content);
        const doc = new docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
        doc.render(getTemplateData());

        // 3. Generate the DOCX file in memory as a "blob"
        const blob = doc.getZip().generate({
            type: "blob",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const docxFilename = generateFilename() + '.docx';

        // 4. Send the file to your Make.com webhook
        button.innerHTML = 'Converting...';
        const formData = new FormData();
        formData.append('file', blob, docxFilename);

        const makeResponse = await fetch(PDF_MAKE_WEBHOOK_URL, {
            method: 'POST',
            body: formData
        });

        if (!makeResponse.ok) throw new Error(`Make.com webhook failed: ${makeResponse.statusText}`);

        // 5. Receive the PDF file directly and trigger the download
        const pdfBlob = await makeResponse.blob();
        const downloadUrl = window.URL.createObjectURL(pdfBlob);

        const link = document.createElement('a');
        link.href = downloadUrl;
        link.setAttribute('download', generateFilename() + '.pdf');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
        
        if (button) {
            button.innerHTML = 'Downloaded! ✅';
        }

    } catch (error) {
        console.error('Error generating PDF:', error);
        alert('Could not generate the PDF. Please check the console for errors.');
        if (button) {
            button.innerHTML = 'Failed! ❌';
        }
    } finally {
        if (button) {
            setTimeout(() => {
                button.innerHTML = originalText ?? 'Proposal PDF 📄';
                button.disabled = false;
            }, 3000);
        }
    }
}
  
    const buildShareStateSnapshot = () => {
        const mainContainer = document.getElementById('main-container');
        const activePresetButton = document.querySelector('.support-presets-main button.active-preset');
        const filteredSupportOverrides = Object.keys(supportPriceOverrides).reduce((acc, tier) => {
            const value = supportPriceOverrides[tier];
            if (value !== null && value !== undefined) {
                acc[tier] = value;
            }
            return acc;
        }, {});

        const state = {
            inputs: {
                'customer-name': document.getElementById('customer-name').value,
                'survey-price': document.getElementById('survey-price').value,
                'quote-number': document.getElementById('quote-number').value,
                'proposal-description': document.getElementById('proposal-description').value,
                'floor-area': document.getElementById('floor-area').value,
                'number-of-floors': document.getElementById('number-of-floors').value,
                'unit-switch': document.querySelector('input[name="unit-switch"]:checked').value,
                'band-switch': document.querySelector('input[name="band-switch"]:checked').value,
                'percent-open': document.getElementById('percent-open').value,
                'percent-cubical': document.getElementById('percent-cubical').value,
                'percent-hollow': document.getElementById('percent-hollow').value,
                'percent-solid': document.getElementById('percent-solid').value,
                'high-ceiling-warehouse': document.getElementById('high-ceiling-warehouse').checked,
                'system-type': document.getElementById('system-type').value,
                'number-of-networks': document.getElementById('number-of-networks').value,
                'max-antennas': document.getElementById('max-antennas').value,
                'no-hardware-checkbox': document.getElementById('no-hardware-checkbox').checked,
                'referral-fee-percent': document.getElementById('referral-fee-percent').value,
                'maintenance-percent': document.getElementById('maintenance-percent').value,
                'include-survey-checkbox': document.getElementById('include-survey-checkbox').checked,
                'total-service-antennas': document.getElementById('total-service-antennas').value,
            },
            overrides: {},
            unitSellOverrides: {},
            support: {
                activePreset: activePresetButton ? activePresetButton.id.replace('support-preset-', '') : null,
                priceOverrides: filteredSupportOverrides,
            },
            pricing: {
                useAltPricing,
            },
            flags: {
                showZeroQuantityItems,
                viewMode: mainContainer && mainContainer.classList.contains('screenshot-mode') ? 'dashboard' : 'simple',
            },
        };

        for (const key in currentResults) {
            if (Object.prototype.hasOwnProperty.call(currentResults, key)) {
                if (currentResults[key].override !== null) {
                    state.overrides[key] = currentResults[key].override;
                }
                if (currentResults[key].unitSellOverride !== null) {
                    state.unitSellOverrides[key] = currentResults[key].unitSellOverride;
                }
            }
        }

        const jsonString = JSON.stringify(state);
        const compressed = pako.deflate(jsonString);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < compressed.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, compressed.subarray(i, i + chunkSize));
        }
        const encodedState = btoa(binary);

        return { state, encodedState };
    };

    const sanitizeSlugValue = (value) => value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

    const normalizeComparisonValue = (value) => {
        if (value === null || value === undefined) {
            return '';
        }
        return sanitizeSlugValue(String(value));
    };

    const tryParseStoredProposalInfo = (rawValue) => {
        if (!rawValue || typeof rawValue !== 'string') {
            return null;
        }

        const trimmed = rawValue.trim();
        if (!trimmed) {
            return null;
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && typeof parsed.slug === 'string') {
                const sanitizedSlug = sanitizeSlugValue(parsed.slug);
                if (!sanitizedSlug) {
                    return null;
                }

                return {
                    slug: sanitizedSlug,
                    quoteNumber: typeof parsed.quoteNumber === 'string' && parsed.quoteNumber ? parsed.quoteNumber : null,
                    customerName: typeof parsed.customerName === 'string' && parsed.customerName ? parsed.customerName : null,
                    source: parsed.source === 'query' ? 'query' : 'auto',
                    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
                };
            }
        } catch (error) {
            // Fall through to legacy handling below.
        }

        const sanitizedLegacySlug = sanitizeSlugValue(trimmed);
        if (!sanitizedLegacySlug) {
            return null;
        }

        return {
            slug: sanitizedLegacySlug,
            quoteNumber: null,
            customerName: null,
            source: 'legacy',
            updatedAt: Date.now(),
        };
    };

    const getStoredProposalInfo = () => {
        try {
            const sessionValue = sessionStorage.getItem(LAST_SAVED_SLUG_KEY);
            const sessionInfo = tryParseStoredProposalInfo(sessionValue);
            if (sessionInfo) {
                return sessionInfo;
            }
        } catch (error) {
            console.warn('Could not read slug info from sessionStorage:', error);
        }

        try {
            const legacyValue = localStorage.getItem(LAST_SAVED_SLUG_KEY);
            const legacyInfo = tryParseStoredProposalInfo(legacyValue);
            if (legacyInfo) {
                try {
                    sessionStorage.setItem(LAST_SAVED_SLUG_KEY, JSON.stringify(legacyInfo));
                } catch (sessionError) {
                    console.warn('Could not migrate slug info to sessionStorage:', sessionError);
                }
                localStorage.removeItem(LAST_SAVED_SLUG_KEY);
                return legacyInfo;
            }
        } catch (error) {
            console.warn('Could not read slug info from localStorage:', error);
        }

        return null;
    };

    const persistStoredProposalInfo = ({ slug, quoteNumber = null, customerName = null, source = 'auto' }) => {
        const sanitizedSlug = slug ? sanitizeSlugValue(String(slug)) : '';
        if (!sanitizedSlug) {
            return;
        }

        const payload = {
            slug: sanitizedSlug,
            quoteNumber: typeof quoteNumber === 'string' && quoteNumber ? quoteNumber : null,
            customerName: typeof customerName === 'string' && customerName ? customerName : null,
            source: source === 'query' ? 'query' : 'auto',
            updatedAt: Date.now(),
        };

        try {
            sessionStorage.setItem(LAST_SAVED_SLUG_KEY, JSON.stringify(payload));
        } catch (error) {
            console.warn('Could not persist slug info to sessionStorage:', error);
        }

        try {
            localStorage.removeItem(LAST_SAVED_SLUG_KEY);
        } catch (error) {
            console.debug('Could not remove legacy slug from localStorage:', error);
        }
    };

    const clearStoredProposalInfo = () => {
        try {
            sessionStorage.removeItem(LAST_SAVED_SLUG_KEY);
        } catch (error) {
            console.warn('Could not clear slug info from sessionStorage:', error);
        }

        try {
            localStorage.removeItem(LAST_SAVED_SLUG_KEY);
        } catch (error) {
            console.debug('Could not clear legacy slug from localStorage:', error);
        }
    };

    const shouldReuseStoredSlug = (storedInfo, { quoteNumber, customerName }) => {
        if (!storedInfo || !storedInfo.slug) {
            return false;
        }

        if (storedInfo.source === 'query') {
            return true;
        }

        const storedQuote = normalizeComparisonValue(storedInfo.quoteNumber);
        const currentQuote = normalizeComparisonValue(quoteNumber);
        if (storedQuote && currentQuote && storedQuote === currentQuote) {
            return true;
        }

        if (!storedQuote && !currentQuote) {
            const storedCustomer = normalizeComparisonValue(storedInfo.customerName);
            const currentCustomer = normalizeComparisonValue(customerName);
            if (storedCustomer && currentCustomer && storedCustomer === currentCustomer) {
                return true;
            }
        }

        return false;
    };

    const deriveSlugCandidate = ({ quoteNumber, customerName }) => {
        const candidates = [quoteNumber]
            .map((value) => (value ? sanitizeSlugValue(String(value)) : ''))
            .filter(Boolean);

        if (candidates.length) {
            return candidates[0];
        }

        const base = customerName ? sanitizeSlugValue(String(customerName)) : '';
        const timestamp = Date.now().toString(36);
        return base ? `${base}-${timestamp}` : `proposal-${timestamp}`;
    };

    const ensureAuthUser = () => {
        if (!window.firebase || !firebase.auth) {
            throw new Error('Firebase auth is not available.');
        }
        const authInstance = firebase.auth();
        const user = authInstance.currentUser;
        if (!user) {
            throw new Error('Please sign in before saving proposals.');
        }
        return user;
    };

    async function saveProposalToPortal({ button = null, openAfterSave = false } = {}) {
        if (!validateInputs(['customer-name', 'survey-price'])) {
            alert('Please fill in both Customer Name and Survey Price before saving the proposal.');
            return null;
        }

        const originalButtonText = button ? button.innerHTML : null;

        try {
            const user = ensureAuthUser();
            const proposalAuthUser = await ensureProposalPortalAuthUser();
            const { encodedState } = buildShareStateSnapshot();
            const proposal = getTemplateData();
            const quoteNumberInput = document.getElementById('quote-number');
            const quoteNumber = quoteNumberInput ? quoteNumberInput.value.trim() : '';
            const storedInfo = getStoredProposalInfo();
            const customerName = proposal.Account || document.getElementById('customer-name').value;
            const reuseStoredSlug = shouldReuseStoredSlug(storedInfo, { quoteNumber, customerName });
            const slugToUse = reuseStoredSlug && storedInfo ? storedInfo.slug : deriveSlugCandidate({ quoteNumber, customerName });

            if (!reuseStoredSlug) {
                clearStoredProposalInfo();
            }

            const requestBody = {
                encodedState,
                proposal,
                overwrite: reuseStoredSlug,
                slug: slugToUse,
            };

            if (button) {
                button.innerHTML = openAfterSave ? 'Opening...' : 'Saving...';
                button.disabled = true;
            }

            const token = await proposalAuthUser.getIdToken(true);
            const response = await fetch(`${PROPOSAL_API_BASE_URL}/api/proposals`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(requestBody),
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload?.error || 'Failed to save proposal.');
            }

            if (payload?.slug) {
                const persistSource = storedInfo?.source === 'query' && reuseStoredSlug ? 'query' : 'auto';
                persistStoredProposalInfo({
                    slug: payload.slug,
                    customerName,
                    quoteNumber,
                    source: persistSource,
                });
            }

            if (button) {
                button.innerHTML = openAfterSave ? 'Opened! ✅' : 'Saved! ✅';
            }
            showSaveStatusMessage('Saved to Proposal Management Portal', 'success', 4000);

            if (openAfterSave && payload?.slug) {
                const url = `${PROPOSAL_APP_BASE_URL}/${payload.slug}`;
                window.open(url, '_blank', 'noopener');
            }

            return payload;
        } catch (error) {
            console.error('Failed to save proposal to portal:', error);
            if (button) {
                button.innerHTML = 'Failed! ❌';
            }
            const isNetworkError = error instanceof TypeError && /fetch/i.test(error.message || '');
            const message = error?.message
                ? error.message
                : isNetworkError
                    ? 'Could not reach the proposal portal. Please check your connection and try again.'
                    : 'Could not save the proposal. Please try again.';
            showSaveStatusMessage(message, 'error', 7000);
            throw error;
        } finally {
            if (button) {
                const restore = () => {
                    const fallbackLabel = openAfterSave ? 'Open Proposal 🚀' : 'Save Proposal 💾';
                    button.innerHTML = originalButtonText !== null ? originalButtonText : fallbackLabel;
                    button.disabled = false;
                };
                setTimeout(restore, 3000);
            }
        }
    }

 async function generateShareLink() {
    const button = document.getElementById('generate-link-btn');
    const originalText = button.innerHTML;

    try {
        button.disabled = true;
        button.innerHTML = 'Generating...';

        const { encodedState } = buildShareStateSnapshot();

        try {
            sessionStorage.setItem(SHARE_STATE_STORAGE_KEY, encodedState);
        } catch (storageError) {
            console.warn('Unable to cache share-state in sessionStorage:', storageError);
        }

        // Build the original Cost Model URL representing the current state
        const costModelUrl = new URL(window.location.pathname, window.location.origin);
        costModelUrl.searchParams.set(SHARE_STATE_QUERY_PARAM, encodedState);
        costModelUrl.hash = encodedState;

        // Wrap it in a portal launch URL so SSO + redirect work correctly
        const portalBase = window.PORTAL_BASE_URL || 'https://portal.uctel.co.uk';
        const launchUrl = new URL('/launch/cost', portalBase);
        launchUrl.searchParams.set('redirect', costModelUrl.toString());

        await navigator.clipboard.writeText(launchUrl.toString());
        button.innerHTML = 'Link Copied! ✅';

    } catch (error) {
        console.error('Failed to generate share link:', error);
        button.innerHTML = 'Failed! ❌';
    } finally {
        setTimeout(() => {
            button.innerHTML = originalText;
            button.disabled = false;
        }, 3000);
    }
}
async function generateInteractiveLink() {
    const button = document.getElementById('generate-interactive-link-btn');
    const originalText = button ? button.innerHTML : null;
    if (button) {
        button.innerHTML = 'Generating...';
        button.disabled = true;
    }

    try {
        const templateData = getTemplateData();
        const systemType = document.getElementById('system-type').value;
        
        const finalData = {
            ...templateData,
            systemType: systemType
        };

        const jsonString = JSON.stringify(finalData);

        // --- THIS IS THE CORRECTED PART ---
        // 1. Deflate to a Uint8Array (the default, most reliable format).
        const compressed = pako.deflate(jsonString);
        
        // 2. Convert the Uint8Array to a binary string that btoa can safely encode.
        const compressedString = String.fromCharCode.apply(null, compressed);
        
        const encodedState = btoa(compressedString);
        // --- END OF CORRECTION ---

        const shareUrl = `${window.location.origin}${window.location.pathname.replace('index.html', '')}interactive-proposal.html#${encodedState}`;

        await navigator.clipboard.writeText(shareUrl);
        if (button) {
            button.innerHTML = 'Link Copied! ✅';
        }
        
    } catch (error) {
        console.error("Failed to generate interactive link:", error);
        if (button) {
            button.innerHTML = 'Failed! ❌';
        }
    } finally {
        if (button) {
            setTimeout(() => {
                button.innerHTML = originalText ?? 'Interactive Proposal 🌐';
                button.disabled = false;
            }, 3000);
        }
    }
}

   function loadStateFromURL() {
    const searchParams = new URLSearchParams(window.location.search);
    const slugFromQuery = searchParams.get('slug');
    let urlNeedsCleanup = false;

    const applyUrlCleanup = (preserveHash = false) => {
        const shouldUpdate = urlNeedsCleanup || (!preserveHash && window.location.hash);
        if (!shouldUpdate) {
            return;
        }
        try {
            const newSearch = searchParams.toString();
            const hashSuffix = preserveHash && window.location.hash ? window.location.hash : '';
            const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + hashSuffix;
            history.replaceState('', document.title, newUrl);
        } catch (cleanupError) {
            console.warn('Unable to clean share-state indicators from URL:', cleanupError);
        }
    };
    if (slugFromQuery) {
        const cleanedSlug = sanitizeSlugValue(slugFromQuery);
        if (cleanedSlug) {
            persistStoredProposalInfo({ slug: cleanedSlug, source: 'query' });
        }

        try {
            searchParams.delete('slug');
            urlNeedsCleanup = true;
        } catch (error) {
            console.warn('Unable to clean slug query parameter:', error);
        }
    }

    let encodedState = searchParams.get(SHARE_STATE_QUERY_PARAM) || '';
    if (encodedState) {
        searchParams.delete(SHARE_STATE_QUERY_PARAM);
        urlNeedsCleanup = true;
    }

    if (!encodedState) {
        encodedState = window.location.hash.substring(1);
    }

    if (encodedState) {
        try {
            sessionStorage.setItem(SHARE_STATE_STORAGE_KEY, encodedState);
        } catch (storageError) {
            console.warn('Unable to cache share-state in sessionStorage:', storageError);
        }
    } else {
        try {
            encodedState = sessionStorage.getItem(SHARE_STATE_STORAGE_KEY) || '';
        } catch (storageError) {
            console.warn('Unable to read share-state from sessionStorage:', storageError);
            encodedState = '';
        }
    }

    if (!encodedState) {
        applyUrlCleanup(true);
        return false;
    }

    try {
        const compressedString = atob(encodedState);
        const compressed = new Uint8Array(compressedString.length);
        for (let i = 0; i < compressedString.length; i++) {
            compressed[i] = compressedString.charCodeAt(i);
        }
        const jsonString = pako.inflate(compressed, { to: 'string' });
        const state = JSON.parse(jsonString);

        let maintenanceFromState = null;
        if (state.inputs && Object.prototype.hasOwnProperty.call(state.inputs, 'maintenance-percent')) {
            maintenanceFromState = state.inputs['maintenance-percent'];
        }

        if (state.inputs) {
            for (const id in state.inputs) {
                const element = document.getElementById(id);
                if (element) {
                    if (element.type === 'checkbox' || element.type === 'radio') {
                        if (element.value === state.inputs[id] || typeof state.inputs[id] === 'boolean') {
                            element.checked = state.inputs[id];
                        }
                    } else {
                        element.value = state.inputs[id];
                    }
                } else {
                    const radio = document.querySelector(`input[name="${id}"][value="${state.inputs[id]}"]`);
                    if (radio) radio.checked = true;
                }
            }
        }

        if (state.overrides) {
            pendingShareOverrides = { ...state.overrides };
            isApplyingShareState = true;
            for (const key in state.overrides) {
                if (!currentResults[key]) {
                    currentResults[key] = { calculated: 0, override: null, decimals: 0, unit: '', unitSellOverride: null, calculatedUnitSell: 0 };
                }
                currentResults[key].override = state.overrides[key];
            }
        }

        if (state.unitSellOverrides) {
            for (const key in state.unitSellOverrides) {
                if (!currentResults[key]) {
                    currentResults[key] = { calculated: 0, override: null, decimals: 0, unit: '', unitSellOverride: null, calculatedUnitSell: 0 };
                }
                currentResults[key].unitSellOverride = state.unitSellOverrides[key];
            }
        }

        if (state.support) {
            if (state.support.priceOverrides) {
                supportPriceOverrides = { ...supportPriceOverrides, ...state.support.priceOverrides };
            }
            if (state.support.activePreset) {
                setSupportPreset(state.support.activePreset);
            }
        }

        if (state.pricing && Object.prototype.hasOwnProperty.call(state.pricing, 'useAltPricing')) {
            useAltPricing = !!state.pricing.useAltPricing;
            updateAltPricingIndicator();
        }

        if (state.flags) {
            if (Object.prototype.hasOwnProperty.call(state.flags, 'showZeroQuantityItems')) {
                showZeroQuantityItems = !!state.flags.showZeroQuantityItems;
                const toggleButton = document.getElementById('toggle-zero-qty-btn');
                if (toggleButton) {
                    toggleButton.textContent = showZeroQuantityItems ? 'Hide Zero Qty Items' : 'Show All Items';
                }
            }
            if (Object.prototype.hasOwnProperty.call(state.flags, 'viewMode')) {
                initialViewMode = state.flags.viewMode === 'simple' ? 'simple' : 'dashboard';
            }
        }

        if (!initialViewMode) {
            initialViewMode = 'dashboard';
        }

        if (maintenanceFromState !== null) {
            const maintenanceField = document.getElementById('maintenance-percent');
            if (maintenanceField) {
                maintenanceField.value = maintenanceFromState;
            }
        }

        applyUrlCleanup(false);

        return true;

    } catch (error) {
        console.error('Failed to load state from URL:', error);
        return false;
    }
}

function applyPendingShareOverrides() {
    if (!pendingShareOverrides || Object.keys(pendingShareOverrides).length === 0) {
        isApplyingShareState = false;
        return;
    }

    isApplyingShareState = true;
    let appliedAny = false;
    for (const key in pendingShareOverrides) {
        if (!Object.prototype.hasOwnProperty.call(pendingShareOverrides, key)) continue;
        const overrideValue = pendingShareOverrides[key];
        if (!currentResults[key]) {
            currentResults[key] = { calculated: 0, override: null, decimals: 0, unit: '', unitSellOverride: null, calculatedUnitSell: 0 };
        }
        currentResults[key].override = overrideValue;
        appliedAny = true;
    }

    pendingShareOverrides = null;

    if (appliedAny) {
        runFullCalculation();
    }

    isApplyingShareState = false;
}
    







    
    initialize();
});

window.updateSellPriceDisplay = (key) => {
    const costInput = document.getElementById(`cost-${key}`);
    const marginInput = document.getElementById(`margin-${key}`);
    const sellDisplay = document.getElementById(`sell-${key}`);
    const cost = parseFloat(costInput.value) || 0;
    const margin = parseFloat(marginInput.value) || 0;
    const sellPrice = cost * (1 + margin / 100);
    sellDisplay.textContent = `£${sellPrice.toFixed(2)}`;
};
// Trigger deployment - August 7, 2025
