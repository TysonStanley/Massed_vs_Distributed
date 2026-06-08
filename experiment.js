// ================================================================
//  experiment.js — Massed vs. Distributed Learning Study
//  Browser / GitHub Pages version (client-side only)
//  Data is downloaded as CSV after each test block.
// ================================================================

// ----------------------------------------------------------------
// Constants (mirror the Python script)
// ----------------------------------------------------------------
const appversion         = '2026.05.18'
console.log('App version: ', appversion);

const SENTENCES_PER_TEST = 40;
const STIMULI_CSV        = 'stimuli_speakers_v2.csv';
const STORY_ID_COL       = 'story_name';
const SUBTITLE_COL       = 'subtitles';
const AUDIO_FILE_COL     = 'filename';

const VALID_SESSIONS = {
  ctrl: ['pre-post', '1-week post', '1-month post'],
  lmtd: ['pre-train-post', '1-week post', '1-month post'],
  mass: ['pre-train-post', '1-week post', '1-month post'],
  dist: ['pre-test', 'train-day1', 'train-day2', 'train-day3',
         'train-day4-post', '1-week post', '1-month post']
};

// One story per dist training day; each is played through twice back-to-back.
// 'train-day4-post' maps to 'train-day4' — see selectTrainingStories().
// Note: the Python experiment has a bug where 'train-day4-post' is never
// matched, so no stories load for that session. The JS version fixes this
// by explicitly mapping 'train-day4-post' → 'train-day4'.
const DIST_STORIES = {
  'train-day1': ['story2'],
  'train-day2': ['story3'],
  'train-day3': ['story4'],
  'train-day4': ['story7']
};

const GROUP_OFFSETS = { ctrl: 0, lmtd: 1, mass: 2, dist: 3 };

// Populated at session start from the user-selected audio folder.
// Maps bare filename (e.g. "OHSp02_Int01.wav") → blob: URL.
const audioBlobURLs = {};

function audioURL(filename) {
  return audioBlobURLs[filename] ?? '';
}


// ----------------------------------------------------------------
// Seeded PRNG — Mulberry32 + Fisher-Yates shuffle
// Produces a deterministic, reproducible shuffle for a given
// participant across all sessions and machines.
// ----------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, seed) {
  const rng = mulberry32(seed >>> 0);
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Derive a 32-bit seed from participant_id via SHA-256.
// Matches Python: int(sha256_hex, 16) % 2**32 → last 4 bytes, big-endian.
async function getSeed(participantId) {
  const buf = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(participantId)
  );
  return new DataView(buf).getUint32(28, false);
}


// ----------------------------------------------------------------
// CSV loading (PapaParse)
// ----------------------------------------------------------------
function loadCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true, header: true, skipEmptyLines: true,
      complete: r => resolve(r.data),
      error:    e => reject(e)
    });
  });
}


// ----------------------------------------------------------------
// Stimuli loading and assignment
// ----------------------------------------------------------------
function getCounterbalancedSpeaker(rows, group, participantId) {
  const speakers = [...new Set(rows.map(r => r.spk))].sort();
  const num = parseInt(participantId.replace(/\D/g, ''), 10);
  const idx = (num - 1 + (GROUP_OFFSETS[group] ?? 0)) % speakers.length;
  return speakers[idx];
}

async function buildTestBlocks(testRows, participantId) {
  const seed     = await getSeed(participantId);
  const shuffled = seededShuffle(testRows, seed);
  return {
    'pre-test':     shuffled.slice(0,                    SENTENCES_PER_TEST),
    'post-test':    shuffled.slice(SENTENCES_PER_TEST,   SENTENCES_PER_TEST * 2),
    '1-week post':  shuffled.slice(SENTENCES_PER_TEST * 2, SENTENCES_PER_TEST * 3),
    '1-month post': shuffled.slice(SENTENCES_PER_TEST * 3, SENTENCES_PER_TEST * 4)
  };
}

async function loadStimuli(group, participantId) {
  const all     = await loadCSV(STIMULI_CSV);
  const speaker = getCounterbalancedSpeaker(all, group, participantId);
  const spk     = all.filter(r => r.spk === speaker);
  const testBlocks = await buildTestBlocks(spk.filter(r => r.type === 'test'), participantId);
  const storyRows  = spk.filter(r => r.type === 'story');
  return { testBlocks, storyRows, speaker };
}

// Returns the story rows for a session. Every training session now plays each
// of its stories through twice back-to-back (see buildTrainingStory); the set
// of stories differs by group/session:
//   lmtd: story2 only
//   mass: story2, story3, story4, story7
//   dist: one story per day (DIST_STORIES)
function selectTrainingStories(storyRows, group, session) {
  if (group === 'lmtd' && session === 'pre-train-post')
    return storyRows.filter(r => r[STORY_ID_COL] === 'story2');

  if (group === 'mass' && session === 'pre-train-post')
    return storyRows.filter(r => ['story2', 'story3', 'story4', 'story7'].includes(r[STORY_ID_COL]));

  // 'train-day4-post' maps to 'train-day4' for story lookup (fixes Python bug)
  const distKey = session === 'train-day4-post' ? 'train-day4' : session;
  if (group === 'dist' && DIST_STORIES[distKey])
    return storyRows.filter(r => DIST_STORIES[distKey].includes(r[STORY_ID_COL]));

  return [];
}


// ----------------------------------------------------------------
// Participant ID validation
// ----------------------------------------------------------------
function validatePid(pid, group) {
  return new RegExp(`^${group}\\d{2}$`).test(pid.trim());
}


// ----------------------------------------------------------------
// Data saving — CSV download + localStorage backup
// ----------------------------------------------------------------
function downloadCSV(rows, filename) {
  const blob = new Blob([Papa.unparse(rows)], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function backupToStorage(key, rows) {
  try {
    const prev = JSON.parse(localStorage.getItem(key) ?? '[]');
    localStorage.setItem(key, JSON.stringify([...prev, ...rows]));
  } catch { /* private mode or quota */ }
}


// ----------------------------------------------------------------
// Custom jsPsych plugin — keyboard text input
// (html-keyboard-response captures keys globally, so we need this
//  custom plugin that hands input focus to an <input> element.)
// ----------------------------------------------------------------
class TextInputPlugin {
  constructor(jsPsych) { this.jsPsych = jsPsych; }

  trial(display, trial) {
    display.innerHTML = `
      <div class="exp-container">
        <p class="exp-prompt">${trial.prompt}</p>
        <input type="text" id="resp" autocomplete="off" spellcheck="false"
               autocorrect="off" autocapitalize="none" class="exp-input">
        <p class="exp-hint">Press ENTER to submit</p>
      </div>`;
    const inp  = display.querySelector('#resp');
    const hint = display.querySelector('.exp-hint');
    inp.focus();
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const response = inp.value;
        if (response.trim() === '') {
          // Block submission of an empty response.
          if (hint) {
            hint.textContent = 'Please type a response before pressing ENTER.';
            hint.classList.add('exp-hint-error');
          }
          return;
        }
        display.innerHTML = '';
        this.jsPsych.finishTrial({ response });
      }
    });
  }
}
TextInputPlugin.info = { name: 'text-input', parameters: {} };


// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Prevent spreadsheet formula injection in downloaded CSVs.
// Prefixes cells starting with =, +, -, @, tab, or CR with a single quote.
function sanitizeCsvCell(value) {
  const s = String(value ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// Instruction screen — press SPACE to advance
function msgTrial(text) {
  return {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="exp-container">
      <p class="exp-text">${esc(text).replace(/\n/g, '<br>')}</p>
      <p class="exp-hint">Press SPACE to continue</p>
    </div>`,
    choices: [' ']
  };
}


// ----------------------------------------------------------------
// Test block
// ----------------------------------------------------------------
function buildTestBlock(participantId, session, label, allTrials) {
  const storageKey = `${participantId}_${label}_partial`;
  const timeline   = [];

  // Recover any partial results saved by a previous interrupted session.
  let results = [];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (Array.isArray(saved) && saved.length > 0 && saved.length < allTrials.length)
      results = saved;
  } catch { }

  const completedCount = results.length;
  const remaining      = allTrials.slice(completedCount);

  if (completedCount > 0) {
    timeline.push(msgTrial(
      `Resuming from trial ${completedCount + 1} of ${allTrials.length}.\n\n` +
      `${completedCount} trials were already recorded and will be included in your results.`
    ));
  } else {
    timeline.push(msgTrial(
      'You are going to hear short sentences spoken by someone with a motor speech disorder.\n\n' +
      'The sentences contain real English words but will not make sense.\n' +
      'Listen carefully — you will hear each sentence only once.\n\n' +
      "After each sentence, type what you heard. Make your best guess. Use 'X' if you have no idea."
    ));
  }

  for (let i = 0; i < remaining.length; i++) {
    const t        = remaining[i];
    const trialNum = completedCount + i + 1;

    // Audio + fixation (auto-advance when audio ends)
    timeline.push({
      type:     jsPsychAudioKeyboardResponse,
      stimulus: audioURL(t[AUDIO_FILE_COL]),
      choices:  'NO_KEYS',
      trial_ends_after_audio:         true,
      response_allowed_while_playing: false,
      prompt:   '<div class="exp-container"><p class="exp-prompt" aria-hidden="true" style="visibility:hidden">Please type what you heard below.</p><div class="fixation">+</div><p class="exp-hint" aria-hidden="true" style="visibility:hidden">Press ENTER to submit</p></div>',
      on_start: () => console.log(
        `[test | ${label}] trial ${trialNum}/${allTrials.length}  ` +
        `${t[AUDIO_FILE_COL]}  →  "${t.target ?? ''}"`
      )
    });

    // Typed response — save to localStorage after every trial
    timeline.push({
      type:   TextInputPlugin,
      prompt: 'Please type what you heard below.',
      on_finish(data) {
        results.push({
          participant_id:   participantId,
          session,
          test_label:       label,
          trial_num:        trialNum,
          [AUDIO_FILE_COL]: t[AUDIO_FILE_COL],
          spk:              t.spk,
          target:           t.target ?? '',
          response:         sanitizeCsvCell(data.response ?? ''),
          timestamp:        new Date().toISOString()
        });
        try { localStorage.setItem(storageKey, JSON.stringify(results)); } catch { }
      }
    });
  }

  // Download CSV, then brief "Saving" screen before continuing
  timeline.push({
    type:           jsPsychHtmlKeyboardResponse,
    stimulus:       '<div class="exp-container"><p class="exp-text">Saving results…</p></div>',
    choices:        'NO_KEYS',
    trial_duration: 1500,
    on_start() {
      console.log(`[save] downloading ${participantId}_${label}_results.csv (${results.length} rows)`);
      downloadCSV(results, `${participantId}_${label}_results.csv`);
      try { localStorage.removeItem(storageKey); } catch { }
    }
  });

  return timeline;
}


// ----------------------------------------------------------------
// Training block
// ----------------------------------------------------------------

// Match Python's exact wording for instructions (lines 528-550 in Python).
// For dist group day > 1, Python intends to modify the task instructions
// but has a whitespace bug that prevents the replace from matching.
// This JS version implements the intended behaviour correctly.
function getTrainingInstructions(group, session) {
  const pd = (
    "The person you have been listening to has Parkinson’s disease, which " +
    "makes their speech difficult to understand. People with Parkinson’s " +
    "disease often find it challenging to improve their speech so that " +
    "other people can better understand them. This can make conversations " +
    "with friends, family, and community members difficult and lead to " +
    "loneliness and depression. We believe we can improve your ability to " +
    "understand this person with some training with their speech. If this " +
    "works, clinicians could provide an alternative approach for improving " +
    "communication by training communication partners to better understand " +
    "the speech."
  );

  // lmtd / mass: passage is played twice with subtitles, then the next passage.
  const taskStandard = (
    "Task Instructions\n\n" +
    "You will now hear the individual read a short passage twice. " +
    "Both times you hear the passage, written subtitles of what the speaker " +
    "is saying will be provided on the screen. Your task is to listen very " +
    "closely to the passage and follow along with the written subtitles to " +
    "help you understand what is being said. You need to listen very " +
    "carefully. When you are finished listening, press SPACE to move to the " +
    "next sentence. This process will repeat for the next passage."
  );

  // dist: only one passage per day, so the closing sentence about repeating
  // for the next passage is omitted.
  const taskDist = (
    "Task Instructions\n\n" +
    "You will now hear the individual read a short passage twice. " +
    "Both times you hear the passage, written subtitles of what the speaker " +
    "is saying will be provided on the screen. Your task is to listen very " +
    "closely to the passage and follow along with the written subtitles to " +
    "help you understand what is being said. You need to listen very " +
    "carefully. When you are finished listening, press SPACE to move to the " +
    "next sentence."
  );

  const taskDistReturnDay = taskDist.replace(
    "Task Instructions\n\nYou will now hear",
    "Task Instructions\n\nThe task itself is the same as the previous day of training. You will hear"
  );

  if (group === 'lmtd' || group === 'mass')
    return ['Now you will begin the training portion of this experiment.', pd, taskStandard];

  if (group === 'dist') {
    const day = parseInt(session.replace(/\D/g, ''), 10);
    const intro = day === 1
      ? 'Welcome to day 1 of training!'
      : `Welcome back to day ${day} of training!\n\n` +
        "In this training, you'll be listening to the same speaker as the previous " +
        "training session, but they will be reading a different passage.";
    return [intro, pd, day === 1 ? taskDist : taskDistReturnDay];
  }

  return [];
}

// One play-through of a story: audio + subtitles, SPACE to advance per
// sentence (available only after the audio finishes). No typing.
function buildStoryPlay(rows, storyName, passLabel) {
  return rows.map((row, i) => ({
    type:     jsPsychAudioKeyboardResponse,
    stimulus: audioURL(row[AUDIO_FILE_COL]),
    choices:  [' '],
    response_allowed_while_playing: false,
    trial_ends_after_audio:         false,
    prompt: `<div class="exp-container">
      <p class="exp-subtitle">${esc(row[SUBTITLE_COL])}</p>
      <p class="exp-hint">Press SPACE to move to the next sentence.</p>
    </div>`,
    on_start: () => console.log(
      `[training | ${storyName} | ${passLabel}] sentence ${i + 1}/${rows.length}  ${row[AUDIO_FILE_COL]}`
    )
  }));
}

// A story is played through twice, back-to-back, with subtitles both times.
function buildTrainingStory(storyRows, storyName) {
  const rows     = storyRows.filter(r => r[STORY_ID_COL] === storyName);
  const timeline = [];

  console.log(
    `[training | ${storyName}] ${rows.length} sentences (played twice): ` +
    rows.map(r => r[AUDIO_FILE_COL]).join(', ')
  );

  timeline.push(msgTrial('Listen carefully and read along with the subtitles.'));
  timeline.push(...buildStoryPlay(rows, storyName, 'play1'));

  timeline.push(msgTrial(
    'Now you will hear the same passage again.\n\n' +
    'Keep listening carefully and read along with the subtitles.'
  ));
  timeline.push(...buildStoryPlay(rows, storyName, 'play2'));

  return timeline;
}

function buildTrainingBlock(storyRows, group, session) {
  if (!storyRows.length) return [];

  const instructions = getTrainingInstructions(group, session);
  const timeline     = instructions.map(page => msgTrial(page));
  const storyNames   = [...new Set(storyRows.map(r => r[STORY_ID_COL]))].sort();

  // Each story is played twice back-to-back (handled in buildTrainingStory),
  // so for mass this yields story2,story2,story3,story3,story4,story4,story7,story7.
  for (const name of storyNames)
    timeline.push(...buildTrainingStory(storyRows, name));

  return timeline;
}


// ----------------------------------------------------------------
// Demographic survey
// ----------------------------------------------------------------
function buildDemographics(participantId) {
  const demo     = { participant_id: participantId };
  const timeline = [];

  // Age — free text
  timeline.push({
    type: TextInputPlugin, prompt: 'What is your age?',
    on_finish: d => { demo.age = sanitizeCsvCell(d.response); }
  });

  const mcItems = [
    { q: 'What is your gender?', key: 'gender',
      opts: ['Man', 'Woman', 'Genderqueer', 'Non-binary', 'Gender fluid', 'My gender is not listed'] },
    { q: 'What is your ethnicity?', key: 'ethnicity',
      opts: ['Hispanic/Latinx', 'Not Hispanic/Latinx'] },
    { q: 'What is your race?', key: 'race',
      opts: ['Caucasian/White', 'African American/Black', 'Native American', 'Asian/Pacific Islander', 'None of the above'] },
    { q: 'What is your native language?', key: 'native_language',
      opts: ['English', 'not English'] },
    { q: 'Do you currently have or have you ever had a speech language impairment?',
      key: 'speech_impairment', opts: ['Yes', 'No'] }
  ];

  for (const item of mcItems) {
    const opts = item.opts;
    timeline.push({
      type:      jsPsychHtmlButtonResponse,
      stimulus:  `<div class="exp-container"><p class="exp-prompt">${esc(item.q)}</p></div>`,
      choices:   opts,
      on_finish: d => { demo[item.key] = opts[d.response]; }
    });
  }

  // Conditional: speech impairment description
  timeline.push({
    timeline: [{
      type:      TextInputPlugin,
      prompt:    'Please describe your speech language impairment:',
      on_finish: d => { demo.speech_impairment_explanation = sanitizeCsvCell(d.response); }
    }],
    conditional_function: () => demo.speech_impairment === 'Yes'
  });

  // Experience with speech disorders
  timeline.push({
    type:     jsPsychHtmlButtonResponse,
    stimulus: `<div class="exp-container">
      <p class="exp-prompt">Do you have significant experience communicating with people with speech disorders (e.g., apraxia, dysarthria, stuttering)?</p>
    </div>`,
    choices:   ['Yes', 'No'],
    on_finish: d => { demo.experience_with_speech_disorders = d.response === 0 ? 'Yes' : 'No'; }
  });

  // Conditional: frequency
  timeline.push({
    timeline: [{
      type:     jsPsychHtmlButtonResponse,
      stimulus: `<div class="exp-container">
        <p class="exp-prompt">How frequently do you communicate with people with speech disorders?</p>
      </div>`,
      choices:   ['Never', 'Once', 'Yearly', 'Monthly', 'Weekly', 'Daily'],
      on_finish: d => {
        demo.frequency_communication = ['Never', 'Once', 'Yearly', 'Monthly', 'Weekly', 'Daily'][d.response];
      }
    }],
    conditional_function: () => demo.experience_with_speech_disorders === 'Yes'
  });

  // Save
  timeline.push({
    type:           jsPsychHtmlKeyboardResponse,
    stimulus:       '<div class="exp-container"><p class="exp-text">Saving demographics…</p></div>',
    choices:        'NO_KEYS',
    trial_duration: 1500,
    on_start() {
      if (!demo.speech_impairment_explanation) demo.speech_impairment_explanation = 'NA';
      if (!demo.frequency_communication)       demo.frequency_communication       = 'NA';
      console.log('[save] downloading demographics CSV');
      downloadCSV([demo], `${participantId}_demographics.csv`);
      // Demographics contain sensitive PII — not backed up to localStorage.
    }
  });

  return timeline;
}


// ----------------------------------------------------------------
// Main timeline assembly
// ----------------------------------------------------------------
function buildTimeline(participantId, group, session, testBlocks, storyRows) {
  const timeline      = [];
  const firstSessions = ['pre-post', 'pre-train-post', 'pre-test'];
  const trainingRows  = selectTrainingStories(storyRows, group, session);

  if (firstSessions.includes(session))
    timeline.push(...buildDemographics(participantId));

  if (session === 'pre-post') {
    // ctrl: pre-test → 5-min break → post-test, no training
    timeline.push(...buildTestBlock(participantId, session, 'pre-test',  testBlocks['pre-test']));
    timeline.push(msgTrial(
      "You've completed part 1. Please take a 5 minute break.\n\n" +
      "The experiment will continue when the researcher is ready."
    ));
    timeline.push(...buildTestBlock(participantId, session, 'post-test', testBlocks['post-test']));

  } else if (session === 'pre-train-post') {
    // lmtd / mass: pre-test → training → post-test
    timeline.push(...buildTestBlock(participantId, session, 'pre-test',  testBlocks['pre-test']));
    timeline.push(...buildTrainingBlock(trainingRows, group, session));
    timeline.push(...buildTestBlock(participantId, session, 'post-test', testBlocks['post-test']));

  } else if (session === 'pre-test') {
    // dist day 0: pre-test only
    timeline.push(...buildTestBlock(participantId, session, 'pre-test', testBlocks['pre-test']));

  } else if (['train-day1', 'train-day2', 'train-day3'].includes(session)) {
    // dist days 1-3: training only
    timeline.push(...buildTrainingBlock(trainingRows, group, session));

  } else if (session === 'train-day4-post') {
    // dist day 4: training → post-test
    timeline.push(...buildTrainingBlock(trainingRows, group, session));
    timeline.push(...buildTestBlock(participantId, session, 'post-test', testBlocks['post-test']));

  } else if (['1-week post', '1-month post'].includes(session)) {
    // All groups: follow-up test only
    timeline.push(...buildTestBlock(participantId, session, session, testBlocks[session]));
  }

  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `<div class="exp-container">
      <p class="exp-text">That's the end of this session — thank you!</p>
      <br>
      <p class="exp-text">Please let the researcher know you have finished.</p>
      <p class="exp-hint">Press SPACE to exit.</p>
    </div>`,
    choices:   [' '],
    on_finish: () => {
      document.body.innerHTML = '<div style="background:#000;height:100vh;"></div>';
    }
  });

  return timeline;
}


// ----------------------------------------------------------------
// Setup screen (plain HTML, shown before jsPsych initialises)
// ----------------------------------------------------------------
function showSetupScreen(onComplete) {
  const root = document.getElementById('setup-screen');
  root.innerHTML = `
    <div class="setup-box">
      <h2>Participant Setup</h2>

      <div id="step1">
        <label for="pid">Participant ID</label>
        <input id="pid" type="text" placeholder="e.g. ctrl01">

        <label for="grp">Group</label>
        <select id="grp">
          <option value="ctrl">ctrl</option>
          <option value="lmtd">lmtd</option>
          <option value="mass">mass</option>
          <option value="dist">dist</option>
        </select>

        <p id="pid-err" class="setup-error"></p>
        <button class="setup-btn" id="btn-next">Next →</button>
      </div>

      <div id="step2" style="display:none;">
        <label for="sess">Session</label>
        <select id="sess"></select>
        <button class="setup-btn" id="btn-start">Select audio folder &amp; start →</button>
      </div>

      <p id="loading-msg" class="setup-loading" style="display:none;">Loading stimuli, please wait…</p>

      <p style="margin-top:32px;border-top:1px solid #222;padding-top:14px;">
        <button id="btn-clear-storage" style="background:none;border:none;color:#444;font-size:0.75em;cursor:pointer;padding:0;font-family:'Courier New',monospace;">
          clear saved progress
        </button>
        <span id="clear-confirm" style="color:#4caf50;font-size:0.75em;margin-left:8px;display:none;">cleared</span>
      </p>
    </div>`;

  const pidInput   = root.querySelector('#pid');
  const grpSelect  = root.querySelector('#grp');
  const pidErr     = root.querySelector('#pid-err');
  const step1      = root.querySelector('#step1');
  const step2      = root.querySelector('#step2');
  const sessSelect = root.querySelector('#sess');
  const loadingMsg = root.querySelector('#loading-msg');

  let chosenPid, chosenGroup, chosenSession;

  root.querySelector('#btn-next').addEventListener('click', () => {
    const pid   = pidInput.value.trim();
    const group = grpSelect.value;
    if (!validatePid(pid, group)) {
      pidErr.textContent = `Expected format: ${group}01 – ${group}99`;
      return;
    }
    pidErr.textContent = '';
    chosenPid   = pid;
    chosenGroup = group;
    sessSelect.innerHTML = VALID_SESSIONS[group]
      .map(s => `<option value="${s}">${s}</option>`).join('');
    step1.style.display = 'none';
    step2.style.display = 'block';
  });

  root.querySelector('#btn-start').addEventListener('click', async () => {
    chosenSession = sessSelect.value;

    // Prompt user to select the folder containing the audio files.
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (e) {
      if (e.name !== 'AbortError')
        pidErr.textContent = 'Could not open folder picker: ' + e.message;
      return;  // user cancelled or browser unsupported — stay on setup screen
    }

    step2.style.display      = 'none';
    loadingMsg.style.display = 'block';
    loadingMsg.textContent   = 'Loading stimuli…';
    onComplete(chosenPid, chosenGroup, chosenSession, dirHandle);
  });

  pidInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') root.querySelector('#btn-next').click();
  });

  root.querySelector('#btn-clear-storage').addEventListener('click', () => {
    const keys = Object.keys(localStorage).filter(k => k.endsWith('_partial'));
    keys.forEach(k => localStorage.removeItem(k));
    const confirm = root.querySelector('#clear-confirm');
    confirm.textContent = keys.length ? `cleared (${keys.length} saved session${keys.length > 1 ? 's' : ''})` : 'nothing to clear';
    confirm.style.display = 'inline';
    setTimeout(() => { confirm.style.display = 'none'; }, 3000);
  });
}


// ----------------------------------------------------------------
// Console summary — called once after stimuli load
// ----------------------------------------------------------------
function logSessionSummary(participantId, group, session, speaker, testBlocks, storyRows) {
  const trainingRows = selectTrainingStories(storyRows, group, session);

  console.group(
    `%c[Session] ${participantId} | group: ${group} | session: ${session}`,
    'font-weight:bold; color:#4fc3f7'
  );
  console.log('Speaker assigned:', speaker);

  console.group('Test blocks');
  for (const [block, rows] of Object.entries(testBlocks)) {
    console.groupCollapsed(`${block} (${rows.length} items)`);
    rows.forEach((r, i) =>
      console.log(`  ${String(i + 1).padStart(3)}. ${r[AUDIO_FILE_COL]}  →  "${r.target ?? ''}"`)
    );
    console.groupEnd();
  }
  console.groupEnd();

  if (trainingRows.length) {
    const storyNames = [...new Set(trainingRows.map(r => r[STORY_ID_COL]))].sort();
    console.group(`Training stories (${storyNames.join(', ')})`);
    for (const name of storyNames) {
      const sentences = trainingRows.filter(r => r[STORY_ID_COL] === name);
      console.groupCollapsed(`${name} (${sentences.length} sentences)`);
      sentences.forEach((r, i) =>
        console.log(`  ${String(i + 1).padStart(3)}. ${r[AUDIO_FILE_COL]}  "${r[SUBTITLE_COL] ?? ''}"`)
      );
      console.groupEnd();
    }
    console.groupEnd();
  } else {
    console.log('Training: none for this session');
  }

  console.groupEnd();
}


// ----------------------------------------------------------------
// Audio preloader — loads only files needed for this session
// ----------------------------------------------------------------
function getSessionAudioFilenames(testBlocks, storyRows, group, session) {
  const files = new Set();

  // Test files used in this session
  const testBlocksUsed = {
    'pre-post':        ['pre-test', 'post-test'],
    'pre-train-post':  ['pre-test', 'post-test'],
    'pre-test':        ['pre-test'],
    'train-day4-post': ['post-test'],
    '1-week post':     ['1-week post'],
    '1-month post':    ['1-month post'],
  };
  for (const key of (testBlocksUsed[session] ?? []))
    (testBlocks[key] ?? []).forEach(r => files.add(r[AUDIO_FILE_COL]));

  // Training files used in this session
  const trainingRows = selectTrainingStories(storyRows, group, session);
  trainingRows.forEach(r => files.add(r[AUDIO_FILE_COL]));

  return [...files];
}

async function preloadAudioFiles(filenames, dirHandle, onProgress) {
  let done = 0;
  for (const filename of filenames) {
    try {
      const fileHandle = await dirHandle.getFileHandle(filename);
      const file       = await fileHandle.getFile();
      audioBlobURLs[filename] = URL.createObjectURL(file);
    } catch {
      console.warn(`Audio file not found in selected folder: ${filename}`);
    }
    onProgress(++done, filenames.length);
  }
}


// ----------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------
showSetupScreen(async (participantId, group, session, dirHandle) => {
  const loadingMsg = document.querySelector('.setup-loading');

  // Load stimuli CSV
  let testBlocks, storyRows, speaker;
  try {
    ({ testBlocks, storyRows, speaker } = await loadStimuli(group, participantId));
  } catch (err) {
    document.body.innerHTML =
      `<div style="background:#000;color:#f77;padding:40px;font-family:monospace;">
         <p>Error loading ${STIMULI_CSV}: ${esc(err.message)}</p>
         <p style="color:#888;margin-top:16px;">Make sure ${STIMULI_CSV} is in the same folder as index.html.</p>
       </div>`;
    return;
  }

  // Preload audio files from the chosen folder
  const filenames = getSessionAudioFilenames(testBlocks, storyRows, group, session);
  await preloadAudioFiles(filenames, dirHandle, (done, total) => {
    if (loadingMsg) loadingMsg.textContent = `Loading audio… ${done}/${total}`;
  });

  logSessionSummary(participantId, group, session, speaker, testBlocks, storyRows);

  document.getElementById('setup-screen').remove();

  const { initJsPsych } = jsPsychModule;
  const jsPsych = initJsPsych({ use_webaudio: true });

  const timeline = buildTimeline(participantId, group, session, testBlocks, storyRows);
  jsPsych.run(timeline);
});
