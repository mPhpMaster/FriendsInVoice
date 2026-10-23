export const STYLE = `
.fivbd-launch{position:fixed;bottom:82px;left:76px;z-index:9000;padding:8px 11px;border-radius:10px;border:1px solid var(--border-subtle);background:var(--background-floating);color:var(--text-normal);cursor:pointer;box-shadow:0 4px 16px #0005}
.fivbd-shade{position:fixed;inset:0;z-index:10000;background:#0009;display:flex;align-items:center;justify-content:center;padding:18px}
.fivbd-panel{width:min(920px,100%);max-height:90vh;display:flex;flex-direction:column;background:var(--background-primary);color:var(--text-normal);border:1px solid var(--border-subtle);border-radius:14px;box-shadow:0 18px 55px #0008;overflow:hidden}
.fivbd-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border-subtle)}
.fivbd-head h2{margin:0;font-size:19px}.fivbd-tabs{display:flex;flex-wrap:wrap;gap:5px;padding:10px 16px;border-bottom:1px solid var(--border-subtle)}
.fivbd-body{padding:16px 18px;overflow:auto;min-height:260px}.fivbd-foot{padding:10px 18px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;color:var(--text-muted)}
.fivbd-panel button,.fivbd-setting button{cursor:pointer;padding:6px 10px;border-radius:7px;border:1px solid var(--border-subtle);background:var(--background-secondary);color:var(--text-normal)}
.fivbd-panel button:disabled{cursor:not-allowed;opacity:.5}.fivbd-panel button:hover:not(:disabled){background:var(--background-mod-strong)}
.fivbd-panel .active{background:var(--brand-500);color:white}.fivbd-panel .danger{color:var(--status-danger,#f23f43)}
.fivbd-search,.fivbd-setting input,.fivbd-setting select{box-sizing:border-box;width:100%;max-width:440px;padding:8px;margin:0 0 14px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--input-background);color:var(--text-normal)}
.fivbd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:12px 0 20px}
.fivbd-card{padding:13px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--background-secondary)}
.fivbd-card h3{margin:0 0 7px;font-size:15px}.fivbd-card p{margin:5px 0;color:var(--text-muted)}
.fivbd-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.fivbd-person{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-subtle)}
.fivbd-muted{color:var(--text-muted)}.fivbd-guard-options{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}.fivbd-guard-options label{display:flex;align-items:center;gap:4px}
.fivbd-log{display:flex;flex-direction:column;margin:12px 0;border:1px solid var(--border-subtle);border-radius:10px;overflow:hidden}
.fivbd-log-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;padding:6px 12px;line-height:1.5}.fivbd-log-row+.fivbd-log-row{border-top:1px solid var(--border-subtle)}
.fivbd-log-myroom{box-shadow:inset 3px 0 0 #f0b232}.fivbd-log-what{flex:1 1 auto;min-width:0}
.fivbd-log-link{font-weight:600;cursor:pointer}.fivbd-log-link:hover{text-decoration:underline}.fivbd-log-place{font-weight:600}
.fivbd-log-select,.fivbd-log-date input{padding:5px 8px;border-radius:7px;border:1px solid var(--border-subtle);background:var(--input-background);color:var(--text-normal);color-scheme:dark}
.fivbd-log-select{max-width:220px;cursor:pointer}.fivbd-log-select option{background:var(--background-floating,#111214);color:var(--text-normal,#dbdee1)}.fivbd-log-date{display:inline-flex;align-items:center;gap:6px;color:var(--text-muted)}
.fivbd-log-pill{padding:0 6px;border-radius:4px;font-size:11px;font-weight:700;background:var(--background-mod-strong)}
.fivbd-empty{padding:20px;text-align:center;color:var(--text-muted)}.fivbd-setting{display:flex;flex-direction:column;gap:12px;padding:12px;color:var(--text-normal)}
.fivbd-whats-new{width:min(640px,100%)}.fivbd-whats-new .fivbd-body{min-height:0;line-height:1.45;user-select:text}
.fivbd-whats-new-release h3{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-size:17px}.fivbd-whats-new-release h4{margin:12px 0 4px;font-size:15px}
.fivbd-whats-new-release p{margin:6px 0}.fivbd-whats-new-release ul{margin:4px 0;padding-left:20px}.fivbd-whats-new-release li{margin:3px 0}
.fivbd-whats-new-release code{padding:0 4px;border-radius:4px;background:var(--background-mod-strong)}
.fivbd-whats-new-release+.fivbd-whats-new-release{margin-top:16px;padding-top:14px;border-top:1px solid var(--border-subtle)}
.fivbd-foot-links{display:flex;gap:7px}.fivbd-link{color:var(--text-link);cursor:pointer}.fivbd-link:hover{text-decoration:underline}
.fivbd-setting label{display:flex;align-items:center;gap:7px}.fivbd-setting input[type=checkbox]{width:auto;margin:0}
`;
