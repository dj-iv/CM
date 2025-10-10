(() => {
  const costModelConfig = Object.freeze({
    apiKey: "AIzaSyAofGv60WL0j0vfqcnrSw-N3tBdHO33TeI",
    authDomain: "cost-model-8c2fc.firebaseapp.com",
    projectId: "cost-model-8c2fc",
    storageBucket: "cost-model-8c2fc.firebasestorage.app",
    messagingSenderId: "659110644015",
    appId: "1:659110644015:web:4a9f3a3ae61ad102c6b9da"
  });

  const proposalPortalConfig = Object.freeze({
    apiKey: "AIzaSyDaBGV7IUOHBOsAottmzeMnTrufok5cpHQ",
    authDomain: "proposal-5823c.firebaseapp.com",
    projectId: "proposal-5823c",
    storageBucket: "proposal-5823c.firebasestorage.app",
    messagingSenderId: "956269534357",
    appId: "1:956269534357:web:388517aa4cf0b836b08f9c"
  });

  const configs = Object.freeze({
    costModel: costModelConfig,
    proposalPortal: proposalPortalConfig,
  });

  window.FIREBASE_CONFIG = costModelConfig;
  window.FIREBASE_CONFIGS = configs;
  window.PROPOSAL_FIREBASE_APP_NAME = 'proposalPortalApp';
})();