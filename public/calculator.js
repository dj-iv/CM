document.addEventListener('DOMContentLoaded', () => {
    // --- MAKE.COM WEBHOOK ---
    const MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/chemsqrmifjs5lwbrquhh1bha0vo96k2';
    const PDF_MAKE_WEBHOOK_URL = 'https://hook.eu1.make.com/cfde3avwbdpr5y131ffkle13z40haem3'; 
    const DEFAULT_PROPOSAL_APP_BASE_URL = 'https://prop.uctel.co.uk';
    const LOCAL_PROPOSAL_APP_BASE_URL = 'http://localhost:3000';
    const PROPOSAL_BASE_URL_STORAGE_KEY = 'calculator-proposal-base-url';

    // Allow overriding the proposal app location via `?proposalBaseUrl=` or
    // a remembered value in localStorage so developers can target staging/dev.

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
        'G41':{label:"GO G41",cost:800.19,margin:0.25},'G43':{label:"GO G43",cost:3149.37,margin:0.25},'QUATRA_NU':{label:"QUATRA 4000e NU",cost:5668.74,margin:0.25},'QUATRA_CU':{label:"QUATRA 4000e CU",cost:3400.74,margin:0.25},'QUATRA_HUB':{label:"QUATRA 4000e HUB",cost:4219.74,margin:0.25},'QUATRA_EVO_NU':{label:"QUATRA EVO NU",cost:2707.74,margin:0.25},'QUATRA_EVO_CU':{label:"QUATRA EVO CU",cost:1731.39,margin:0.25},'QUATRA_EVO_HUB':{label:"QUATRA EVO HUB",cost:2243.8,margin:0.25},'extender_cat6':{label:"Q4000 CAT6 Range Extender",cost:426.43,margin:0.25},'extender_fibre_cu':{label:"Q4000 Fibre Extender CU",cost:755.99,margin:0.25},'extender_fibre_nu':{label:"Q4000 Fibre Extender NU",cost:986.61,margin:0.25},'service_antennas':{label:"Omni Ceiling Antenna",cost:11.22,margin:7},'donor_wideband':{label:"Log-periodic Antenna",cost:20.08,margin:5},'donor_lpda':{label:"LPDA-R Antenna",cost:57.87,margin:3.5},'antenna_bracket':{label:"Antenna Bracket",cost:40,margin:0.5},
        'hybrids_4x4':{label:"4x4 Hybrid Combiner",cost:183.05,margin:1.0},
        'hybrids_2x2':{label:"2x2 Hybrid Combiner",cost:30.12,margin:3.0},
        'splitters_4way':{label:"4-Way Splitter",cost:18.36,margin:3},'splitters_3way':{label:"3-Way Splitter",cost:15.36,margin:3},'splitters_2way':{label:"2-Way Splitter",cost:14.18,margin:3},'pigtails':{label:"N-Male to SMA-Male Pigtail",cost:5.02,margin:5},'coax_lmr400':{label:"LMR400/HDF400 Coax Cable",cost:1.25,margin:3},'coax_half':{label:"1/2in Coax Cable",cost:1.78,margin:3},
        'cable_cat':{label:"CAT6 Cable",cost:0.7,margin:0.5},
        'cable_fibre':{label:"Fibre Cable/Patch",cost:100,margin:0.3},'connectors':{label:"N-Type Connectors",cost:1.42,margin:3},'connectors_rg45':{label:"RJ45 Connectors",cost:0.4,margin:2.5},'adapters_sfp':{label:"SFP Adapter",cost:25,margin:3},
        'adapters_n':{label:"4.3/10 to N Adapter",cost:4.61,margin:5.0},
        'install_internal':{label:"Installation (Internal)",cost:150,margin:3},'install_external':{label:"Installation (External)",cost:600,margin:0.5},'cherry_picker':{label:"Cherry Picker",cost:480,margin:0.3},'travel_expenses':{label:"Travel Expenses",cost:150,margin:0},
        'support_package': {label: "Annual Support Package", cost: 0, margin: 0},
'survey_price_item': {label: "Site Survey", cost: 0, margin: 0}
    };    
    const supportData = {
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
    const systemCalculators = {
        'G41': params => { const { B_SA, C_Net, D_DA, E_Max } = params; let r = getBaseCalculations(params, 'G41'); const num_systems = (B_SA === 0 || E_Max === 0) ? 0 : Math.ceil(B_SA / E_Max); r.G41 = num_systems * C_Net; const G_DonorPorts = C_Net * num_systems; const SA_per_set = (num_systems === 0) ? 0 : Math.ceil(B_SA / num_systems); const is_4x4 = (C_Net === 4 && SA_per_set >= 3), is_2x2 = (C_Net === 2 && SA_per_set >= 2); let s4=0,s3=0,s2=0; if (is_4x4 || is_2x2) { const num_outputs=is_4x4?4:2,antennas_per_output=Math.ceil(SA_per_set/num_outputs),splitters=getSplitterCascade(antennas_per_output); s4=splitters.d4*num_outputs;s3=splitters.d3*num_outputs;s2=splitters.d2*num_outputs;} else { const d4=(SA_per_set<=1)?0:((SA_per_set===6)?0:((SA_per_set%4===1)?Math.max(0,Math.floor(SA_per_set/4)-1):Math.floor(SA_per_set/4))),d3=(SA_per_set<=1)?0:Math.floor((SA_per_set-4*d4)/3),d2=(SA_per_set<=1)?0:Math.ceil((SA_per_set-4*d4-3*d3)/2),nd=d4+d3+d2; s4=d4+((C_Net===4)?1:0)+((nd===4)?1:0);s3=d3+((C_Net===3)?1:0)+((nd===3)?1:0);s2=d2+((C_Net===2)?1:0)+((nd===2)?1:0);} let d4_way=0,d3_way=0,d2_way=0; if(G_DonorPorts>D_DA&&D_DA>0){ const p_ceil=Math.ceil(G_DonorPorts/D_DA),p_floor=Math.floor(G_DonorPorts/D_DA),n_ceil=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_floor=D_DA-n_ceil; const s_ceil=getSplitterCascade(p_ceil),s_floor=getSplitterCascade(p_floor); d4_way=n_ceil*s_ceil.d4+n_floor*s_floor.d4;d3_way=n_ceil*s_ceil.d3+n_floor*s_floor.d3;d2_way=n_ceil*s_ceil.d2+n_floor*s_floor.d2;} r.hybrids_4x4=is_4x4?num_systems:0;r.hybrids_2x2=is_2x2?num_systems:0; r.splitters_4way=(s4*num_systems)+d4_way;r.splitters_3way=(s3*num_systems)+d3_way;r.splitters_2way=(s2*num_systems)+d2_way; r.pigtails=r.G41+G_DonorPorts; r.connectors=(B_SA+D_DA)+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+(r.hybrids_4x4*8+r.hybrids_2x2*4); r.install_internal=Math.ceil((B_SA/3)+(D_DA/3)+(r.G41/4)+1); return r; },
        'G43': params => { const { B_SA, C_Net, D_DA, E_Max } = params; let r = getBaseCalculations(params, 'G43'); const is_4_nets=(C_Net===4),outputs_per_set=is_4_nets?6:3,max_antennas_per_set=outputs_per_set*E_Max; const num_sets=(B_SA>0&&max_antennas_per_set>0)?Math.ceil(B_SA/max_antennas_per_set):0; r.G43=is_4_nets?(num_sets*2):num_sets;r.hybrids_2x2=is_4_nets?(num_sets*3):0;r.hybrids_4x4=0; const G_DonorPorts=is_4_nets?(num_sets*6):(num_sets*3); let s4_t=0,s3_t=0,s2_t=0; if(B_SA>0&&E_Max>0){const total_outputs=num_sets*outputs_per_set,antennas_per_output=total_outputs>0?Math.ceil(B_SA/total_outputs):0; const splitters=getSplitterCascade(antennas_per_output); s4_t=splitters.d4*total_outputs;s3_t=splitters.d3*total_outputs;s2_t=splitters.d2*total_outputs;} let d4_t=0,d3_t=0,d2_t=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_ceil=Math.ceil(G_DonorPorts/D_DA),p_floor=Math.floor(G_DonorPorts/D_DA),n_ceil=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_floor=D_DA-n_ceil; const s_ceil=getSplitterCascade(p_ceil),s_floor=getSplitterCascade(p_floor); d4_t=n_ceil*s_ceil.d4+n_floor*s_floor.d4;d3_t=n_ceil*s_ceil.d3+n_floor*s_floor.d3;d2_t=n_ceil*s_ceil.d2+n_floor*s_floor.d2;} r.splitters_4way=s4_t+d4_t;r.splitters_3way=s3_t+d3_t;r.splitters_2way=s2_t+d2_t; r.pigtails=is_4_nets?(num_sets*6):0; r.connectors=(B_SA+D_DA)+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+(r.hybrids_4x4*8+r.hybrids_2x2*4); r.install_internal=Math.ceil((B_SA/3)+(D_DA/3)+(r.G43/4)+1); return r; },
        'QUATRA': params => { const { B_SA, C_Net, D_DA } = params; let r=getBaseCalculations(params, 'QUATRA'); r.QUATRA_CU=B_SA; const num_full=Math.floor(r.QUATRA_CU/12),rem_cus=r.QUATRA_CU%12; r.QUATRA_NU=num_full+(rem_cus>0?1:0);r.QUATRA_HUB=num_full+(rem_cus>6?1:0); const G_DonorPorts=4*r.QUATRA_NU;let d4=0,d3=0,d2=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_c=Math.ceil(G_DonorPorts/D_DA),p_f=Math.floor(G_DonorPorts/D_DA),n_c=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_f=D_DA-n_c; const s_c=getSplitterCascade(p_c),s_f=getSplitterCascade(p_f); d4=n_c*s_c.d4+n_f*s_f.d4;d3=n_c*s_c.d3+n_f*s_f.d3;d2=n_c*s_c.d2+n_f*s_f.d2;} r.splitters_4way=d4;r.splitters_3way=d3;r.splitters_2way=d2; r.adapters_n=r.QUATRA_CU+r.QUATRA_NU*C_Net;r.connectors_rg45=r.QUATRA_CU*4; r.cable_fibre=r.QUATRA_HUB;r.adapters_sfp=r.QUATRA_HUB*2;r.cable_cat=r.QUATRA_CU*200; r.connectors=D_DA+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+G_DonorPorts; r.install_internal=Math.ceil((r.QUATRA_CU/2)+(D_DA/2)+(r.QUATRA_NU/7)+1); r.extender_cat6=0;r.extender_fibre_cu=0;r.extender_fibre_nu=0; return r;},
        'QUATRA_DAS': params => { const { B_SA, C_Net, D_DA, E_Max } = params; let r=getBaseCalculations(params, 'QUATRA_DAS'); r.QUATRA_CU=(B_SA===0||E_Max===0)?0:Math.ceil(B_SA/E_Max); const SA_per_set=(r.QUATRA_CU===0)?0:Math.ceil(B_SA/r.QUATRA_CU); const s_per_cu=getSplitterCascade(SA_per_set); const s_4W=s_per_cu.d4*r.QUATRA_CU,s_3W=s_per_cu.d3*r.QUATRA_CU,s_2W=s_per_cu.d2*r.QUATRA_CU; const num_full=Math.floor(r.QUATRA_CU/12),rem_cus=r.QUATRA_CU%12; r.QUATRA_NU=num_full+(rem_cus>0?1:0);r.QUATRA_HUB=num_full+(rem_cus>6?1:0); const G_DonorPorts=4*r.QUATRA_NU;let d4=0,d3=0,d2=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_c=Math.ceil(G_DonorPorts/D_DA),p_f=Math.floor(G_DonorPorts/D_DA),n_c=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_f=D_DA-n_c; const s_c=getSplitterCascade(p_c),s_f=getSplitterCascade(p_f); d4=n_c*s_c.d4+n_f*s_f.d4;d3=n_c*s_c.d3+n_f*s_f.d3;d2=n_c*s_c.d2+n_f*s_f.d2;} r.splitters_4way=s_4W+d4;r.splitters_3way=s_3W+d3;r.splitters_2way=s_2W+d2; r.adapters_n=r.QUATRA_CU+r.QUATRA_NU*C_Net;r.connectors_rg45=r.QUATRA_CU*4; r.cable_fibre=r.QUATRA_HUB;r.adapters_sfp=r.QUATRA_HUB*2;r.cable_cat=r.QUATRA_CU*200; r.connectors=(B_SA+D_DA)+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+G_DonorPorts; r.install_internal=Math.ceil((B_SA/3)+(r.QUATRA_CU/2)+(D_DA/2)+(r.QUATRA_NU/7)+1); r.extender_cat6=0;r.extender_fibre_cu=0;r.extender_fibre_nu=0; return r;},
        'QUATRA_EVO': params => { const { B_SA, C_Net, D_DA } = params; let r=getBaseCalculations(params, 'QUATRA_EVO'); r.QUATRA_EVO_CU=B_SA; const num_full=Math.floor(r.QUATRA_EVO_CU/12),rem_cus=r.QUATRA_EVO_CU%12; r.QUATRA_EVO_NU=num_full+(rem_cus>0?1:0);r.QUATRA_EVO_HUB=num_full+(rem_cus>6?1:0); const G_DonorPorts=2*r.QUATRA_EVO_NU;let d4=0,d3=0,d2=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_c=Math.ceil(G_DonorPorts/D_DA),p_f=Math.floor(G_DonorPorts/D_DA),n_c=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_f=D_DA-n_c; const s_c=getSplitterCascade(p_c),s_f=getSplitterCascade(p_f); d4=n_c*s_c.d4+n_f*s_f.d4;d3=n_c*s_c.d3+n_f*s_f.d3;d2=n_c*s_c.d2+n_f*s_f.d2;} r.splitters_4way=d4;r.splitters_3way=d3;r.splitters_2way=d2; r.adapters_n=r.QUATRA_EVO_CU+r.QUATRA_EVO_NU*C_Net;r.connectors_rg45=r.QUATRA_EVO_CU*4; r.cable_fibre=r.QUATRA_EVO_HUB;r.adapters_sfp=r.QUATRA_EVO_HUB*2;r.cable_cat=r.QUATRA_EVO_CU*200; r.connectors=D_DA+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+G_DonorPorts; r.install_internal=Math.ceil((r.QUATRA_EVO_CU/2)+(D_DA/2)+(r.QUATRA_EVO_NU/7)+1); r.extender_cat6=0;r.extender_fibre_cu=0;r.extender_fibre_nu=0; return r;},
        'QUATRA_EVO_DAS': params => { const { B_SA, C_Net, D_DA, E_Max } = params; let r=getBaseCalculations(params, 'QUATRA_EVO_DAS'); r.QUATRA_EVO_CU=(B_SA===0||E_Max===0)?0:Math.ceil(B_SA/E_Max); const SA_per_set=(r.QUATRA_EVO_CU===0)?0:Math.ceil(B_SA/r.QUATRA_EVO_CU); const s_per_cu=getSplitterCascade(SA_per_set); const s_4W=s_per_cu.d4*r.QUATRA_EVO_CU,s_3W=s_per_cu.d3*r.QUATRA_EVO_CU,s_2W=s_per_cu.d2*r.QUATRA_EVO_CU; const num_full=Math.floor(r.QUATRA_EVO_CU/12),rem_cus=r.QUATRA_EVO_CU%12; r.QUATRA_EVO_NU=num_full+(rem_cus>0?1:0);r.QUATRA_EVO_HUB=num_full+(rem_cus>6?1:0); const G_DonorPorts=2*r.QUATRA_EVO_NU;let d4=0,d3=0,d2=0; if(G_DonorPorts>D_DA&&D_DA>0){const p_c=Math.ceil(G_DonorPorts/D_DA),p_f=Math.floor(G_DonorPorts/D_DA),n_c=(G_DonorPorts%D_DA===0)?0:(G_DonorPorts%D_DA),n_f=D_DA-n_c; const s_c=getSplitterCascade(p_c),s_f=getSplitterCascade(p_f); d4=n_c*s_c.d4+n_f*s_f.d4;d3=n_c*s_c.d3+n_f*s_f.d3;d2=n_c*s_c.d2+n_f*s_f.d2;} r.splitters_4way=s_4W+d4;r.splitters_3way=s_3W+d3;r.splitters_2way=s_2W+d2; r.adapters_n=r.QUATRA_EVO_CU+r.QUATRA_EVO_NU*C_Net;r.connectors_rg45=r.QUATRA_EVO_CU*4; r.cable_fibre=r.QUATRA_EVO_HUB;r.adapters_sfp=r.QUATRA_EVO_HUB*2;r.cable_cat=r.QUATRA_EVO_CU*200; r.connectors=(B_SA+D_DA)+(r.splitters_4way*5+r.splitters_3way*4+r.splitters_2way*3)+G_DonorPorts; r.install_internal=Math.ceil((B_SA/3)+(r.QUATRA_EVO_CU/2)+(D_DA/2)+(r.QUATRA_EVO_NU/7)+1); r.extender_cat6=0;r.extender_fibre_cu=0;r.extender_fibre_nu=0; return r;}
    };

    let priceData = {};
    let altPriceData = {};
    let useAltPricing = false;
    let currentResults = {};
    let showZeroQuantityItems = false;
    let subTotalsForProposal = {};
    let supportPriceOverrides = { bronze: null, silver: null, gold: null };
    let isDataInitialized = false;
    let saveStatusMessageTimeout = null;

    const updateAltPricingIndicator = () => {
        const indicator = document.getElementById('alt-pricing-indicator');
        if (!indicator) return;
        if (useAltPricing && isDataInitialized) {
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    };
    function populateSettingsModal() {
        const container = document.getElementById('settings-form-container');
        let html = `
            <div class="pricing-controls">
                <label class="alt-pricing-toggle">
                    <input type="checkbox" id="use-alt-pricing" ${useAltPricing ? 'checked' : ''}>
                    Use Alternative Pricing
                </label>
            </div>
            <div class="setting-item setting-header">
                <span>Component</span>
                <span>Cost (£)</span>
                <span>Margin (%)</span>
                <span>Sell (£)</span>
                <span>Alt Cost (£)</span>
                <span>Alt Margin (%)</span>
                <span>Alt Sell (£)</span>
            </div>`;
        const sortedKeys = Object.keys(priceData).sort((a, b) => priceData[a].label.localeCompare(priceData[b].label));
        for(const key of sortedKeys) {
            const item = priceData[key];
            const altItem = altPriceData[key] || { cost: item.cost, margin: item.margin };
            const sellPrice = item.cost * (1 + item.margin);
            const altSellPrice = altItem.cost * (1 + altItem.margin);
            html += `<div class="setting-item">
                <label for="cost-${key}">${item.label}</label>
                <input type="number" step="0.01" id="cost-${key}" value="${item.cost.toFixed(2)}">
                <input type="number" step="0.01" id="margin-${key}" value="${(item.margin * 100).toFixed(2)}">
                <span id="sell-${key}" class="sell-price-display">£${sellPrice.toFixed(2)}</span>
                <input type="number" step="0.01" id="alt-cost-${key}" value="${altItem.cost.toFixed(2)}">
                <input type="number" step="0.01" id="alt-margin-${key}" value="${(altItem.margin * 100).toFixed(2)}">
                <span id="alt-sell-${key}" class="sell-price-display">£${altSellPrice.toFixed(2)}</span>
            </div>`;
        }
        container.innerHTML = html;
    
        for(const key of sortedKeys) {
            const costInput = document.getElementById(`cost-${key}`);
            const marginInput = document.getElementById(`margin-${key}`);
            const altCostInput = document.getElementById(`alt-cost-${key}`);
            const altMarginInput = document.getElementById(`alt-margin-${key}`);
            
            const handler = () => window.updateSellPriceDisplay(key);
            const altHandler = () => window.updateAltSellPriceDisplay(key);
            
            if(costInput) costInput.addEventListener('input', handler);
            if(marginInput) marginInput.addEventListener('input', handler);
            if(altCostInput) altCostInput.addEventListener('input', altHandler);
            if(altMarginInput) altMarginInput.addEventListener('input', altHandler);
        }

        // Add event listener for the alternative pricing toggle
        const altPricingToggle = document.getElementById('use-alt-pricing');
        if(altPricingToggle) {
            altPricingToggle.addEventListener('change', (e) => {
                useAltPricing = e.target.checked;
                updateAltPricingIndicator();
                runFullCalculation();
            });
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

    // Setup modal tabs functionality
    function setupModalTabs() {
        const tabLinks = document.querySelectorAll('.tab-link');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = link.getAttribute('data-tab');
                
                // Remove active class from all tabs and contents
                tabLinks.forEach(tl => tl.classList.remove('active'));
                tabContents.forEach(tc => tc.classList.remove('active'));
                
                // Add active class to clicked tab and corresponding content
                link.classList.add('active');
                document.getElementById(targetTab).classList.add('active');
            });
        });
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

    function setupSettingsModal() { 
        const modal = document.getElementById('settings-modal'), btn = document.getElementById('settings-btn'), closeBtn = modal.querySelector('.close-btn'), cancelBtn = document.getElementById('modal-cancel'), saveBtn = document.getElementById('modal-save'); 
        btn.onclick = () => { 
            populateSettingsModal(); 
            populateCoverageModal();
            setupModalTabs();
            modal.style.display = "block"; 
        }; 
        const closeModal = () => modal.style.display = "none"; 
        closeBtn.onclick = closeModal; cancelBtn.onclick = closeModal; 
        window.onclick = (event) => { if (event.target == modal) closeModal(); }; 
      saveBtn.onclick = async () => { 
    const newPriceData = JSON.parse(JSON.stringify(priceData)); 
    const newAltPriceData = {};
    const newCoverageData = JSON.parse(JSON.stringify(coverageData));
    let allValid = true; 
    
    // Validate and save pricing data
    for(const key in newPriceData) { 
        const newCost = parseFloat(document.getElementById(`cost-${key}`).value);
        const newMargin = parseFloat(document.getElementById(`margin-${key}`).value) / 100;
        const newAltCost = parseFloat(document.getElementById(`alt-cost-${key}`).value);
        const newAltMargin = parseFloat(document.getElementById(`alt-margin-${key}`).value) / 100;
        
        if (!isNaN(newCost) && !isNaN(newMargin) && !isNaN(newAltCost) && !isNaN(newAltMargin)) { 
            newPriceData[key].cost = newCost; 
            newPriceData[key].margin = newMargin;
            newAltPriceData[key] = {
                label: newPriceData[key].label,
                cost: newAltCost,
                margin: newAltMargin
            };
        } else { 
            allValid = false; 
        } 
    }
    
    // Validate and save coverage data
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
    
    const altPricingCheckbox = document.getElementById('use-alt-pricing');
    const newUseAltPricing = altPricingCheckbox ? altPricingCheckbox.checked : false;
    
    if(allValid) { 
        await savePrices(newPriceData, newAltPriceData, newUseAltPricing);
        await saveCoverageData(newCoverageData);
        closeModal(); 
    } else { 
        alert("Please ensure all values are valid numbers."); 
    } 
};
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
    
    function populateSupportTable() {
        const table = document.getElementById('support-table');
        if (!table) return;
        let html = `<thead><tr><th>Included Services</th><th>Description</th><th>Bronze</th><th>Silver</th><th>Gold</th><th>dpm/sys</th><th>dpy/sys</th></tr></thead><tbody>`;
        for (const key in supportData) {
            const item = supportData[key];
            const dpy = item.dpm * 12;
            html += `<tr><td>${item.label}</td><td>${item.description}</td>
                <td><input type="checkbox" class="support-checkbox" data-key="${key}" data-tier="bronze"></td>
                <td><input type="checkbox" class="support-checkbox" data-key="${key}" data-tier="silver"></td>
                <td><input type="checkbox" class="support-checkbox" data-key="${key}" data-tier="gold"></td>
                <td><input type="number" class="dpm-input" data-key="${key}" value="${item.dpm.toFixed(4)}" step="0.0001"></td>
                <td><span id="dpy-${key}">${dpy.toFixed(4)}</span></td></tr>`;
        }
        html += `</tbody><tfoot>
            <tr class="summary-row"><td colspan="2" style="text-align:right;">Summary per system per year (£)</td><td id="bronze-sys-summary">£0.00</td><td id="silver-sys-summary">£0.00</td><td id="gold-sys-summary">£0.00</td><td colspan="2"></td></tr>
            <tr class="summary-row"><td colspan="2" style="text-align:right;">Summary per year (£)</td><td id="bronze-year-summary">£0.00</td><td id="silver-year-summary">£0.00</td><td id="gold-year-summary">£0.00</td><td colspan="2"></td></tr>
        </tfoot>`;
        table.innerHTML = html;
        document.querySelectorAll('.support-checkbox').forEach(box => box.addEventListener('change', () => {
            document.querySelectorAll('.support-presets-main button').forEach(b => b.classList.remove('active-preset'));
            runFullCalculation();
        }));
        document.querySelectorAll('.dpm-input').forEach(el => {
            el.addEventListener('input', (e) => {
                const key = e.target.dataset.key;
                const dpySpan = document.getElementById(`dpy-${key}`);
                const dpmValue = parseFloat(e.target.value) || 0;
                if (dpySpan) dpySpan.textContent = (dpmValue * 12).toFixed(4);
            });
            el.addEventListener('change', runFullCalculation);
        });
    }

  // calculator.js

// REPLACE the old loadPrices function with this new async version
async function loadPrices() {
    const pricesDocRef = firebase.firestore().collection('settings').doc('prices');
    const altPricesDocRef = firebase.firestore().collection('settings').doc('altPrices');
    const settingsDocRef = firebase.firestore().collection('settings').doc('general');
    
    try {
        // Load standard prices
        const doc = await pricesDocRef.get();
        if (doc.exists) {
            console.log("Prices loaded from Firestore.");
            const firestorePrices = doc.data();
            priceData = { ...defaultPriceData, ...firestorePrices };
        } else {
            console.log("No prices document in Firestore, using default data.");
            priceData = JSON.parse(JSON.stringify(defaultPriceData));
        }

        // Load alternative prices
        const altDoc = await altPricesDocRef.get();
        if (altDoc.exists) {
            console.log("Alternative prices loaded from Firestore.");
            altPriceData = altDoc.data();
        } else {
            console.log("No alternative prices document, initializing with default data.");
            altPriceData = JSON.parse(JSON.stringify(defaultPriceData));
        }

        // Load settings (including useAltPricing flag)
        const settingsDoc = await settingsDocRef.get();
        if (settingsDoc.exists) {
            const settings = settingsDoc.data();
            useAltPricing = settings.useAltPricing || false;
            console.log("Settings loaded from Firestore. Use Alt Pricing:", useAltPricing);
            updateAltPricingIndicator();
        }
        
    } catch (e) {
        console.error("Could not load pricing data from Firestore, using default data.", e);
        priceData = JSON.parse(JSON.stringify(defaultPriceData));
        altPriceData = JSON.parse(JSON.stringify(defaultPriceData));
        useAltPricing = false;
        updateAltPricingIndicator();
    }
}
   async function savePrices(newPriceData, newAltPriceData, newUseAltPricing) {
    const pricesDocRef = firebase.firestore().collection('settings').doc('prices');
    const altPricesDocRef = firebase.firestore().collection('settings').doc('altPrices');
    const settingsDocRef = firebase.firestore().collection('settings').doc('general');
    
    try {
        // Save all the data in parallel
        await Promise.all([
            pricesDocRef.set(newPriceData),
            altPricesDocRef.set(newAltPriceData),
            settingsDocRef.set({ useAltPricing: newUseAltPricing }, { merge: true })
        ]);
        
        // Update local variables
        priceData = newPriceData;
        altPriceData = newAltPriceData;
        useAltPricing = newUseAltPricing;
    updateAltPricingIndicator();
        
        runFullCalculation();
        alert('Pricing settings saved successfully to the database!');
    } catch (e) {
        console.error("Could not save pricing data to Firestore.", e);
        alert('Error: Could not save pricing data to the database.');
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
        return useAltPricing ? altPriceData : priceData;
    }

    function getSplitterCascade(k) { if (k <= 1) return { d4: 0, d3: 0, d2: 0 }; const d4_dist = (k === 6) ? 0 : ((k % 4 === 1) ? Math.max(0, Math.floor(k / 4) - 1) : Math.floor(k / 4)); const d3_dist = Math.floor((k - 4 * d4_dist) / 3); const d2_dist = Math.ceil((k - 4 * d4_dist - 3 * d3_dist) / 2); const num_dist = d4_dist + d3_dist + d2_dist; return { d4: d4_dist + ((num_dist === 4) ? 1 : 0), d3: d3_dist + ((num_dist === 3) ? 1 : 0), d2: d2_dist + ((num_dist === 2) ? 1 : 0) }; }
    function getBaseCalculations(params, systemType) { const { B_SA, D_DA } = params; let service_coax = (B_SA * 30); if (systemType === 'QUATRA' || systemType === 'QUATRA_EVO') { service_coax = 0; } const coax_total = service_coax + (D_DA * 50); return { donor_lpda: 0, donor_wideband: D_DA, antenna_bracket: D_DA, coax_half: 0, coax_lmr400: coax_total, cherry_picker: 0, install_external: 0, travel_expenses: 0, }; }
    function activateEditMode(cell, key) { const displaySpan = cell.querySelector('.value-display'), inputField = cell.querySelector('.value-input'); displaySpan.classList.add('hidden'); inputField.classList.remove('hidden'); const currentValue = currentResults[key].override !== null ? currentResults[key].override : currentResults[key].calculated; inputField.value = currentValue; inputField.focus(); inputField.select(); }
    function deactivateEditMode(cell, key, save) { const displaySpan = cell.querySelector('.value-display'), inputField = cell.querySelector('.value-input'); if (save) { const newValue = parseFloat(inputField.value); if (!isNaN(newValue)) { currentResults[key].override = newValue; runFullCalculation(); } } else { inputField.classList.add('hidden'); displaySpan.classList.remove('hidden'); } }
    function updateCellDisplay(cell, key) { const item = currentResults[key], displaySpan = cell.querySelector('.value-display'), isOverridden = item.override !== null, value = isOverridden ? item.override : item.calculated; displaySpan.textContent = `${value.toFixed(item.decimals || 0)}`; displaySpan.classList.toggle('overridden', isOverridden); }
    
   function calculateCoverageRequirements() {
    console.log('calculateCoverageRequirements called');
    
    // --- Define variables first ---
    const systemType = document.getElementById('system-type').value;
    const floorArea = parseFloat(document.getElementById('floor-area').value) || 0;
    const unit = document.querySelector('input[name="unit-switch"]:checked').value;
    const band = document.querySelector('input[name="band-switch"]:checked').value;
    const isQuatraWithHighCeiling = ['QUATRA', 'QUATRA_EVO'].includes(systemType);
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
    const isNonDasQuatra = systemType === 'QUATRA' || systemType === 'QUATRA_EVO';
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
        if (systemType.includes('EVO') && parseInt(networksInput.value) > 2) { networksInput.value = '2'; }

        let serviceAntennaCount = parseInt(document.getElementById('total-service-antennas').value) || 0;
        const isNonDasQuatra = systemType === 'QUATRA' || systemType === 'QUATRA_EVO';
        
        if (isNonDasQuatra) {
            const cuKey = systemType === 'QUATRA' ? 'QUATRA_CU' : 'QUATRA_EVO_CU';
            if (currentResults[cuKey] && currentResults[cuKey].override !== null) {
                serviceAntennaCount = currentResults[cuKey].override;
            }
        } else {
            if (currentResults['service_antennas'] && currentResults['service_antennas'].override !== null) {
                serviceAntennaCount = currentResults['service_antennas'].override;
            }
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
                currentResults[key] = { calculated: calculatedValues[key], override: null, decimals: 0, unit: { coax_half: ' (m)', coax_lmr400: ' (m)', cable_cat: ' (m)', install_internal: ' (Days)', install_external: ' (Days)' }[key] || '' };
            }
        }
        if(!currentResults['service_antennas']) { currentResults['service_antennas'] = { calculated: 0, override: null, decimals: 0, unit: '' }; }
        currentResults['service_antennas'].calculated = params.B_SA;
        const internal_days = currentResults['install_internal']?.override ?? currentResults['install_internal']?.calculated ?? 0;
        if(currentResults['travel_expenses']) { currentResults['travel_expenses'].calculated = internal_days; } else { currentResults['travel_expenses'] = { calculated: internal_days, override: null, decimals: 0, unit: ' (Days)'}; }
        
        let totalHardwareSellPrice = 0, totalHardwareUnits = 0;
        const hardwareKeys = ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB', 'extender_cat6', 'extender_fibre_cu', 'extender_fibre_nu'];
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
                 activePricing['support_package'].label = `Annual Custom Support Package`;
            }
        } else {
            activePricing['support_package'].label = "Annual Support Package";
        }

        updateDOM();
        updateAllSupportTierPrices();
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
        hardware: ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB', 'extender_cat6', 'extender_fibre_cu', 'extender_fibre_nu'],
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
    };

    let subTotals = { hardware: { cost: 0, sell: 0, margin: 0 }, consumables: { cost: 0, sell: 0, margin: 0 }, services: { cost: 0, sell: 0, margin: 0 } };

    for (const groupName in itemGroups) {
        let groupHTML = '';
        let itemsInGroupDisplayed = 0;

        itemGroups[groupName].forEach(key => {
            if (!currentResults[key]) currentResults[key] = { calculated: 0, override: null, decimals: 0, unit: '' };
            const itemResult = currentResults[key];
            const activePricing = getActivePriceData();
            const priceInfo = activePricing[key] || { cost: 0, margin: 0, label: 'N/A' };
            
            const isSupport = key === 'support_package';
            const quantity = isSupport ? 1 : (itemResult.override !== null ? itemResult.override : itemResult.calculated);
            
            let isRelevant = true;
            if (groupName === 'hardware' || groupName === 'consumables') { isRelevant = false; if (componentRelevance.all.includes(key)) isRelevant = true; if (componentRelevance[systemType]?.includes(key)) isRelevant = true; if (systemType.includes('G4') && componentRelevance.go.includes(key)) isRelevant = true; if (systemType.includes('QUATRA') && componentRelevance.quatra.includes(key)) isRelevant = true; }
            if (isSupport && priceInfo.cost === 0 && itemResult.override === null) isRelevant = false;

            if (isRelevant && (quantity > 0 || showZeroQuantityItems)) {
                itemsInGroupDisplayed++;

                const finalCost = parseFloat(priceInfo.cost) || 0;
                const margin = parseFloat(priceInfo.margin) || 0;
                const qty = parseFloat(quantity) || 0;
                const upliftVal = parseFloat(uplift) || 1;
                
                const baseTotalSell = (isSupport ? finalCost : (finalCost * (1 + margin))) * qty;
                const finalTotalSell = baseTotalSell * upliftVal;
                const trueLineMargin = baseTotalSell - (finalCost * qty);
                const finalUnitSell = qty > 0 ? finalTotalSell / qty : 0;
                
                // Add to sub-totals, ensuring they are numbers
                subTotals[groupName].sell += isNaN(finalTotalSell) ? 0 : finalTotalSell;
                subTotals[groupName].cost += isNaN(finalCost * qty) ? 0 : (finalCost * qty);
                subTotals[groupName].margin += isNaN(trueLineMargin) ? 0 : trueLineMargin;

                const qtyDisplay = isSupport ? '1' : `<span class="value-display"></span><input type="number" step="any" class="value-input hidden" />`;
                const qtyClass = isSupport ? '' : 'item-qty';
                
                let totalSellDisplay = `£${finalTotalSell.toFixed(2)}`;
                let totalSellClass = '';
                if (isSupport) {
                    totalSellClass = 'price-override item-qty'; // Re-use item-qty class for event handling
                    totalSellDisplay = `<span class="value-display"></span><input type="number" step="any" class="value-input hidden" />`;
                }

                groupHTML += `<tr>
                    <td class="col-item item-name">${priceInfo.label}${itemResult.unit || ''}</td>
                    <td class="col-qty ${qtyClass}" data-key="${key}">${qtyDisplay}</td>
                    <td class="col-sell">£${finalUnitSell.toFixed(2)}</td>
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
    
    function toggleMultiFloorUI() {
        const systemType = document.getElementById('system-type').value;
        const isNonDasQuatra = systemType === 'QUATRA' || systemType === 'QUATRA_EVO';
        const floorsGroup = document.getElementById('number-of-floors-group');
        const areaLabel = document.getElementById('floor-area-label');
        if (isNonDasQuatra) { floorsGroup.style.display = 'flex'; areaLabel.textContent = 'Area per Floor'; } else { floorsGroup.style.display = 'none'; areaLabel.textContent = 'Floor Area'; }
    }
    
    // --- SUPPORT & MODAL FUNCTIONS ---
    function setSupportPreset(tier) {
        document.querySelectorAll('.support-presets-main button').forEach(b => b.classList.remove('active-preset'));
        const presetBtn = document.getElementById(`support-preset-${tier}`);
        if(presetBtn) presetBtn.classList.add('active-preset');
        document.querySelectorAll('.support-checkbox').forEach(box => { const key = box.dataset.key; const boxTier = box.dataset.tier; box.checked = supportData[key].tiers.includes(tier) && boxTier === tier; });
        document.getElementById('maintenance-percent').value = (tier === 'none') ? 0 : 5;
        runFullCalculation();
    }
    function updateSupportTableSummaries(totalHardwareUnits) {
        const activePricing = getActivePriceData();
        if (!activePricing.install_internal) return; 
        const dailyInstallRate = activePricing.install_internal.cost * (1 + activePricing.install_internal.margin);
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
        for (const tier of ['bronze', 'silver', 'gold']) {
            const sysSummaryCell = document.getElementById(`${tier}-sys-summary`);
            const yearSummaryCell = document.getElementById(`${tier}-year-summary`);
            if(sysSummaryCell) sysSummaryCell.textContent = `£${(tierPerSystemDPY[tier] * dailyInstallRate).toFixed(2)}`;
            const fixedServicesCost = tierFixedAnnualDPY[tier] * dailyInstallRate;
            if(yearSummaryCell) yearSummaryCell.textContent = `£${fixedServicesCost.toFixed(2)}`;
        }
    }
   function getSpecificSupportCost(tier, totalHardwareUnits, totalHardwareSellPrice) {
    if (supportPriceOverrides[tier] !== null) {
        return parseFloat(supportPriceOverrides[tier]) || 0;
    }
    let totalPerSystemDPY = 0, totalFixedAnnualDPY = 0;
    const maintenancePercent = (tier === 'none') ? 0 : 5;
    for (const key in supportData) {
        if (supportData[key].tiers.includes(tier)) {
            const dpyValue = (parseFloat(supportData[key].dpm) || 0) * 12;
            if (supportData[key].type === 'per_system') totalPerSystemDPY += dpyValue;
            else totalFixedAnnualDPY += dpyValue;
        }
    }
    const activePricing = getActivePriceData();
    const dailyInstallRate = (parseFloat(activePricing.install_internal?.cost) * (1 + parseFloat(activePricing.install_internal?.margin))) || 0;
    const perSystemCost = (parseFloat(totalPerSystemDPY) || 0) * (parseFloat(dailyInstallRate) || 0) * (parseFloat(totalHardwareUnits) || 0);
    const fixedAnnualCost = (parseFloat(totalFixedAnnualDPY) || 0) * (parseFloat(dailyInstallRate) || 0);
    const maintenanceCost = (parseFloat(totalHardwareSellPrice) || 0) * (parseFloat(maintenancePercent) || 0) / 100;
    const result = (parseFloat(perSystemCost) || 0) + (parseFloat(fixedAnnualCost) || 0) + (parseFloat(maintenanceCost) || 0);
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
            'QUATRA_EVO_DAS': 'CEL-FI-QUATRA-EVO-Proposal-Template.docx'
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
            openProposalTemp(event);
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
        toggleMultiFloorUI();
        calculateCoverageRequirements();
    });

   document.querySelectorAll('#number-of-networks, #max-antennas, #no-hardware-checkbox, #referral-fee-percent, #maintenance-percent, #customer-name, #survey-price, #quote-number, #total-service-antennas, #include-survey-checkbox').forEach(input => {
        input.addEventListener('input', runFullCalculation);
        input.addEventListener('change', runFullCalculation);
    });

    document.getElementById('reset-overrides').addEventListener('click', () => { for (const key in currentResults) { if (currentResults[key].hasOwnProperty('override')) currentResults[key].override = null; } setSupportPreset('none'); runFullCalculation(); });
    document.getElementById('toggle-zero-qty-btn').addEventListener('click', (e) => { showZeroQuantityItems = !showZeroQuantityItems; e.target.textContent = showZeroQuantityItems ? 'Hide Zero Qty Items' : 'Show All Items'; runFullCalculation(); });

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
        resultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: #57708A;">Loading data…</td></tr>`;
    }

    await loadPrices(); // Use await here
    await loadCoverageData(); // Load coverage data from database
    setupSettingsModal();
    populateSupportTable();
    toggleMultiFloorUI();

    isDataInitialized = true;
    updateAltPricingIndicator();

    // --- Final Calculation Logic ---
    if (!stateLoaded) {
        setSupportPreset('none');
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
        const isQuatraWithHighCeiling = ['QUATRA', 'QUATRA_EVO'].includes(systemType);
        
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
    const hardwareKeys = ['G41', 'G43', 'QUATRA_NU', 'QUATRA_CU', 'QUATRA_HUB', 'QUATRA_EVO_NU', 'QUATRA_EVO_CU', 'QUATRA_EVO_HUB'];
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
            'QUATRA_EVO_DAS': 'CEL-FI-QUATRA-EVO-Proposal-Template.docx'
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
            return null;
        }

        const originalButtonText = button ? button.innerHTML : null;

        try {
            const user = ensureAuthUser();
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

            const token = await user.getIdToken(true);
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

            const statusMessage = document.getElementById('save-status-message');
            if (statusMessage) {
                statusMessage.textContent = 'Saved to Proposal Management Portal';
                statusMessage.classList.remove('hidden');
                if (saveStatusMessageTimeout) {
                    clearTimeout(saveStatusMessageTimeout);
                }
                saveStatusMessageTimeout = window.setTimeout(() => {
                    statusMessage.classList.add('hidden');
                }, 4000);
            }

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
            alert(error.message || 'Could not save the proposal. Please try again.');
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

        const shareUrl = `${window.location.origin}${window.location.pathname}#${encodedState}`;
        await navigator.clipboard.writeText(shareUrl);
        button.innerHTML = 'Link Copied! ✅';

    } catch (error) {
        console.error("Failed to generate share link:", error);
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

async function openProposalTemp(event) {
    const button = event?.currentTarget || document.getElementById('proposal-temp-btn');
    try {
        await saveProposalToPortal({ button, openAfterSave: true });
    } catch (error) {
        // Error surface handled in saveProposalToPortal
    }
}
    
   function loadStateFromURL() {
    const searchParams = new URLSearchParams(window.location.search);
    const slugFromQuery = searchParams.get('slug');
    if (slugFromQuery) {
        const cleanedSlug = sanitizeSlugValue(slugFromQuery);
        if (cleanedSlug) {
            persistStoredProposalInfo({ slug: cleanedSlug, source: 'query' });
        }

        try {
            searchParams.delete('slug');
            const newSearch = searchParams.toString();
            const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
            history.replaceState('', document.title, newUrl);
        } catch (error) {
            console.warn('Unable to clean slug query parameter:', error);
        }
    }

    let encodedState = window.location.hash.substring(1);
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

    if (!encodedState) return false;

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
                    currentResults[key] = { calculated: 0, override: null, decimals: 0, unit: '' };
                }
                currentResults[key].override = state.overrides[key];
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

        if (window.location.hash) {
            history.replaceState('', document.title, window.location.pathname + window.location.search);
        }

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
            currentResults[key] = { calculated: 0, override: null, decimals: 0, unit: '' };
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
