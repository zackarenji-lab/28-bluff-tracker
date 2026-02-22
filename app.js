import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy,
  getDocs, deleteDoc, limit, where, updateDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const FIREBASE_CONF = {
  apiKey: "AIzaSyBdAIdEDwfoalevfadgixPTLIoLoEqi8kc",
  authDomain: "bluff-tracker-7542e.firebaseapp.com",
  projectId: "bluff-tracker-7542e",
  storageBucket: "bluff-tracker-7542e.appspot.com",
  messagingSenderId: "280965687037",
  appId: "1:280965687037:web:be0b05da36ef653ab68094"
};
const SECRET_KEY = "zachariahrenji";
const TEAM_LIST = ["Bibin & Zach","Bimal & Annu","Bibin & Annu","Zach & Daddy","Bibin & Bimal","Zach & Rikku","Bibin & Daddy"];

const app = initializeApp(FIREBASE_CONF);
const db = getFirestore(app);
const gamesRef = collection(db, "games");

let gameData = { games: [] };

function computeAggregates() {
  const seriesMap = {};
  const teamStats = {};

  gameData.games.forEach(g => {
    if (!seriesMap[g.seriesId]) {
      seriesMap[g.seriesId] = { 
        id: g.seriesId, target: g.seriesTarget || 5, wins: {}, games: [], 
        startedAt: g.seriesStartedAt || g.time, isRandom: false 
      };
    }
    const s = seriesMap[g.seriesId];
    if (g.manualEnd) {
        s.isRandom = true;
    } else {
        s.games.push(g);
        s.wins[g.winner] = (s.wins[g.winner] || 0) + 1;
        if(!teamStats[g.winner]) teamStats[g.winner] = { wins: 0, losses: 0, series: 0 };
        if(!teamStats[g.loser]) teamStats[g.loser] = { wins: 0, losses: 0, series: 0 };
        teamStats[g.winner].wins++;
        teamStats[g.loser].losses++;
    }
  });

  const active = [];
  const finished = [];
  Object.values(seriesMap).forEach(s => {
    const reachedTarget = Object.values(s.wins).some(w => w >= s.target);
    s.isFinished = s.isRandom || reachedTarget;
    if (s.isFinished) {
      const teams = Object.keys(s.wins);
      s.winner = teams.length > 0 ? teams.reduce((a, b) => s.wins[a] > s.wins[b] ? a : b, teams[0]) : "No Games Played";
      if(!s.isRandom && teamStats[s.winner]) teamStats[s.winner].series++;
      finished.push(s);
    } else { active.push(s); }
  });
  return { active, finished, teamStats };
}

function renderUI() {
  const { active, teamStats } = computeAggregates();
  const list = document.getElementById("activeList");
  if(!list) return;

  document.getElementById("noActive").style.display = active.length ? "none" : "block";
  list.innerHTML = "";

  active.forEach(s => {
    const teams = Array.from(new Set(s.games.flatMap(g => [g.winner, g.loser])));
    const tA = teams[0] || "Team A";
    const tB = teams[1] || "Team B";
    const wA = s.wins[tA] || 0;
    const wB = s.wins[tB] || 0;
    
    list.innerHTML += `
      <div class="series-card">
        <div class="score-row">
          <div class="score-box"><strong>${tA}</strong><div class="score-val">${wA}</div></div>
          <div style="font-size:10px; color:var(--muted)">VS</div>
          <div class="score-box"><strong>${tB}</strong><div class="score-val">${wB}</div></div>
        </div>
        <div class="p-bar-bg">
          <div class="p-fill" style="width:${(wA/s.target)*100}%; background:var(--accent)"></div>
          <div class="p-fill" style="width:${(wB/s.target)*100}%; background:var(--gold); margin-left:auto"></div>
        </div>
        <div class="btn-group" style="display:flex; gap:8px; margin-top:10px;">
          <button class="neu-btn primary" style="flex:1" onclick="addWin('${s.id}', '${tA}', '${tB}')">Win: ${tA.split(' ')[0]}</button>
          <button class="neu-btn primary" style="flex:1; background:var(--gold)" onclick="addWin('${s.id}', '${tB}', '${tA}')">Win: ${tB.split(' ')[0]}</button>
          <button class="neu-btn stop btn-stop-full" onclick="endSeriesEarly('${s.id}')">STOP</button>
        </div>
      </div>
    `;
  });

  const sortedTeams = Object.keys(teamStats).sort((a,b) => teamStats[b].wins - teamStats[a].wins);
  document.getElementById("championText").innerText = sortedTeams[0] || "Waiting for data...";
  updateStatsPage();
}

window.endSeriesEarly = async (sId) => {
    if(confirm("End this series now? Individual wins are saved, but the series target is ignored.")) {
        await addDoc(gamesRef, { seriesId: sId, manualEnd: true, time: new Date().toISOString(), secret: SECRET_KEY });
    }
};

window.addWin = async (sId, winner, loser) => {
  const s = computeAggregates().active.find(x => x.id === sId);
  await addDoc(gamesRef, { seriesId: sId, winner, loser, seriesTarget: s.target, time: new Date().toISOString(), secret: SECRET_KEY });
};

window.startNewSeries = () => {
  const opts = TEAM_LIST.map(t => `<option value="${t}">${t}</option>`).join("");
  showModal(`
    <div class="confirm-box">
      <h3 style="margin-top:0">Start New Series</h3>
      <select id="mTarget" class="neu-btn" style="width:100%; margin-bottom:10px;"><option value="5">First to 5</option><option value="10">First to 10</option></select>
      <select id="mTA" class="neu-btn" style="width:100%; margin-bottom:10px;">${opts}</select>
      <select id="mTB" class="neu-btn" style="width:100%; margin-bottom:10px;">${opts}</select>
      <button class="neu-btn primary" style="width:100%; margin-bottom:8px" onclick="confirmStart()">Start Now</button>
      <button class="neu-btn" style="width:100%" onclick="closeModal()">Cancel</button>
    </div>
  `);
};

window.confirmStart = async () => {
    const tA = document.getElementById('mTA').value;
    const tB = document.getElementById('mTB').value;
    if(tA === tB) return alert("Select different teams!");
    const sId = "s_" + Date.now();
    await addDoc(gamesRef, { seriesId: sId, winner: tA, loser: tB, time: new Date().toISOString(), seriesTarget: parseInt(document.getElementById('mTarget').value), secret: SECRET_KEY });
    closeModal();
};

function updateStatsPage() {
    const { teamStats, finished } = computeAggregates();
    const cont = document.getElementById("statsContent");
    if(!cont) return;
    
    let html = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px;">
        <div class="card" style="margin:0; text-align:center; padding:15px;"><small>Total Wins</small><div style="font-size:20px; font-weight:800">${gameData.games.filter(g=>!g.manualEnd).length}</div></div>
        <div class="card" style="margin:0; text-align:center; padding:15px;"><small>Series Won</small><div style="font-size:20px; font-weight:800">${finished.filter(s=>!s.isRandom).length}</div></div>
    </div>`;

    html += `<h3>Global Leaderboard</h3>`;
    Object.entries(teamStats).sort((a,b) => b[1].wins - a[1].wins).forEach(([name, data]) => {
        html += `<div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:14px;">
            <span>${name}</span>
            <span><strong>${data.wins}W</strong> - ${data.losses}L</span>
        </div>`;
    });

    html += `<h3 style="margin-top:25px">Series History</h3>`;
    finished.slice().reverse().forEach(s => {
        const typeLabel = s.isRandom ? `<span class="badge-random">Random Game</span>` : `<span style="font-size:9px; color:var(--accent); margin-left:8px;">COMPETITIVE</span>`;
        const teams = Object.keys(s.wins);
        const scoreStr = teams.length > 1 ? `${s.wins[teams[0]]} - ${s.wins[teams[1]]}` : "Series Aborted";
        html += `<div style="font-size:12px; margin-bottom:12px; background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.03);">
            <strong>${s.winner}</strong> won ${typeLabel}<br>
            <span style="color:var(--muted)">${scoreStr}</span>
        </div>`;
    });
    cont.innerHTML = html;
}

function showModal(html) { document.getElementById("modalContainer").innerHTML = `<div class="overlay">${html}</div>`; }
window.closeModal = () => document.getElementById("modalContainer").innerHTML = "";

onSnapshot(query(gamesRef, orderBy("time")), snap => {
  gameData.games = snap.docs.map(d => d.data());
  renderUI();
});

window.resetStats = async () => {
    if(prompt("Reset all stats? Enter Password:") === SECRET_KEY) {
        const snap = await getDocs(gamesRef);
        snap.forEach(d => deleteDoc(d.ref));
    }
};

window.shareToWhatsApp = () => {
    const { teamStats } = computeAggregates();
    let msg = "🏆 Bluff Masters Rankings\n\n";
    Object.entries(teamStats).forEach(([n, d]) => {
        msg += `${n}: ${d.wins} Wins\n`;
    });
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank");
};
