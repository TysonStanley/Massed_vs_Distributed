# Import libraries
import os, sys
os.environ['QT_QPA_PLATFORM_PLUGIN_PATH'] = os.path.join(
    sys.prefix, 'lib', 'python3.10', 'site-packages', 'PyQt6', 'Qt6', 'plugins', 'platforms'
)
from psychopy import prefs
prefs.hardware['audioLib'] = ['sounddevice']
prefs.app['gui'] = 'wx'
from psychopy import core, visual, event, data, gui, sound
import pandas as pd
import numpy as np
from datetime import datetime
import random
import re
import hashlib

# Fixed parameters
sentences_per_test = 40
n_test_sessions = 3
data_folder = 'data'
audio_folder = 'audio'
stimuli_csv = 'stimuli_speakers.csv'
story_id_col = 'story_name'
subtitle_col = 'subtitles'
audio_file_col = 'filename'

# Valid sessions for drop-down menu in dialogue box 2
valid_sessions = {
    'ctrl': ['pre-post', '1-week post', '1-month post'],
    'lmtd': ['pre-train-post', '1-week post', '1-month post'],
    'mass': ['pre-train-post', '1-week post', '1-month post'],
    'dist': ['pre-test', 'train-day1', 'train-day2',
             'train-day3', 'train-day4-post', '1-week post', '1-month post']
    }

# Which test block each session will draw from (does not include training blocks) 
test_block_for_session = {
    'pre-post': ('pre-test', 'post-test'),
    'pre-train-post': ('pre-test', 'post-test'),
    'pre-test': ('pre-test'),
    'train-day4-post': ('post-test'),
    '1-week post': ('1-week post'),
    '1-month post': ('1-month post')
}

# Dist group: story pairs per training session
dist_stories = {
    'train-day1': ['story2', 'story3'],
    'train-day2': ['story4', 'story7'],
    'train-day3': ['story3', 'story4'],
    'train-day4': ['story2', 'story7']
}

# Speaker counterbalancing: each group starts at a different offset
group_offsets = {'ctrl': 0, 'lmtd': 1, 'mass': 2, 'dist': 3}

# Setting up the window
win = visual.Window(
    size = [1024, 768],
    color = 'black',
    units = 'height',
    fullscr = False
)


############################
# Dialogue Boxes 
############################
"""
This chunk sets up two dialogue boxes that pop up at the beginning of the experiment.
In the first box, the RA will insert the participant ID and select their group from a drop-down menu.
The participant ID must follow the specified format (e.g., 4-letter group code followed by 2-digit number, ctrl01)
or else the box will throw an error message.

The second box will use the group label to pull up a drop-down menu of sessions. 
The RA will select the appropriate session given where the participant is in the timeline.
For example, if lmtd03 is back for their 1-week follow-up, the RA will select '1-week post' from the menu.
"""

def validate_participant_id(pid, group):
    """ 
    Enforce format: group shorthand + exactly 2 digits (e.g., ctrl02, dist04).
    Returns (True, '') or (False, error_message).
    """
    pattern = rf'^{re.escape(group)}\d{{2}}$'
    if re.match(pattern, pid):
        return True, ''
    return False, (
        f"Participant ID must be the group code followed by a 2-digit number.\n"
        f"Expected format: {group}01, {group}02, ... {group}99\n"
        f"You entered: '{pid}'"
    )

def run_dialogue():
    """
    Two-step dialogue box.
    Step 1: participant_id + group (loops until ID format is valid)
    Step 2: session label filtered to valid options for the chosen group.
    Returns (participant_id, group, session).
    """
    while True:
        dlg1 = gui.DlgFromDict(
            dictionary = {'participant_id': '', 'group': ['ctrl', 'lmtd', 'mass', 'dist']},
            title = 'Step 1 of 2 - Participant info',
            order = ['participant_id', 'group']
        )
        if not dlg1.OK:
            core.quit()
        
        pid = dlg1.data[0].strip()
        group = dlg1.data[1]
        
        valid, msg = validate_participant_id(pid, group)
        if valid:
            break
        
        err = gui.Dlg(title = 'Invalid participant ID')
        err.addText(msg)
        err.show()
        if not err.OK:
            core.quit()
    
    dlg2 = gui.DlgFromDict(
        dictionary = {'session': valid_sessions[group]},
        title = 'Step 2 of 2 - Session',
        order = ['session']
    )
    if not dlg2.OK:
        core.quit()
    
    session = dlg2.data[0]
    return pid, group, session

####################################
# User Interface Set-up
####################################
"""
This section sets up the types of windows to refer to later.
show_message() sets up a window with text displayed on it.
show_multiple_choice() sets up the page for several demographic questionnaire prompts.
show_text_input() sets up a window where the participant can type a response and submit by pressing ENTER.
"""

def show_message(win, text):
    """
    Full-screen message; waits for key then returns.
    """
    visual.TextStim(win, text = text, height = 0.05,
                    color = 'white', wrapWidth = 1.2).draw()
    win.flip()
    keys = event.waitKeys(keyList = ['space', 'escape'])
    if 'escape' in keys:
        win.close()
        core.quit()

def show_multiple_choice(win, question, options):
    """Display a multiple choice question and return selected option."""
    
    selected_index = 0
    
    question_text = visual.TextStim(
        win,
        text=question,
        pos=[0, 0.3],
        height=0.05,
        color='white',
        wrapWidth=0.9
    )
    
    instruction_text = visual.TextStim(
        win,
        text='Use UP/DOWN arrows to select, SPACE to confirm.',
        pos=[0, -0.4],
        height=0.03,
        color='gray',
        wrapWidth=0.9
    )
    
    while True:
        win.flip()
        
        question_text.draw()
        instruction_text.draw()
        
        for i, option in enumerate(options):
            y_pos = 0.1 - (i * 0.08)
            
            if i == selected_index:
                option_text = visual.TextStim(
                    win,
                    text=f'> {option}',
                    pos=[0, y_pos],
                    height=0.04,
                    color='yellow',
                    bold=True
                )
            else:
                option_text = visual.TextStim(
                    win,
                    text=f'  {option}',
                    pos=[0, y_pos],
                    height=0.04,
                    color='white'
                )
            option_text.draw()
        win.flip()
        
        keys = event.waitKeys(keyList=['up', 'down', 'space', 'escape'])
        
        if 'escape' in keys:
            win.close()
            core.quit()
        elif 'up' in keys:
            selected_index = (selected_index - 1) % len(options)
        elif 'down' in keys:
            selected_index = (selected_index + 1) % len(options)
        elif 'space' in keys:
            return options[selected_index]


def show_text_input(win, prompt):
    """Display a text input field and return the entered text."""
    
    input_text = ''
    
    special = {'comma': ',', 'period': '.', 'minus': '-',
                'apostrophe': "'", 'semicolon': ';', 'slash': '/'}
    
      
    prompt_stim = visual.TextStim(
        win,
        text=prompt,
        pos=[0, 0.3],
        height=0.05,
        color='white',
        wrapWidth=0.9
    )
    
    instruction_stim = visual.TextStim(
        win,
        text='Type your response. Press ENTER when finished.',
        pos=[0, -0.3],
        height=0.03,
        color='gray'
    )
    
    input_display = visual.TextStim(
        win,
        text='',
        pos=[0, 0],
        height=0.04,
        color='yellow',
        wrapWidth=0.8
    )
    
    while True:
        prompt_stim.draw()
        instruction_stim.draw()
        input_display.text = input_text + '_'
        input_display.draw()
        win.flip()
        
        keys = event.waitKeys()
        
        if 'escape' in keys:
            win.close()
            core.quit()
        elif 'return' in keys:
            return input_text
        elif 'backspace' in keys:
            input_text = input_text[:-1]
        elif 'space' in keys:
            input_text += ' '
        else:
            for key in keys:
                if len(key) == 1:
                    input_text += key
                elif key in special: 
                    input_text += special[key]


##############################
# Demographic Survey
##############################
"""
This runs through the demographic survey and saves the results to a file with the participant_id.
"""

def show_demographic_survey(win, participant_id):
    """
    Display fullscreen demographic survey and return responses to CSV.
    Called in first session only. 
    """
    demo = {'participant_id': participant_id}
    demo['age'] = show_text_input(win, 'What is your age?')
    
    mc_items = [
        ('What is your gender?',
         ['man', 'woman', 'genderqueer', 'non-binary', 'gender fluid',
          'my gender is not listed'], 'gender'),
        ('What is your ethnicity?',
         ['hispanic/latinx', 'not hispanic/latinx'], 'ethnicity'),
        ('What is your race?',
         ['caucasian/white', 'african american/black', 'native american',
          'Asian/Pacific Islander', 'none of the above'], 'race'),
        ('What is your native language?',
         ['English', 'not English'], 'native_language'),
        ('Do you currently have or have you ever had a speech language impairment?',
         ['yes', 'no'], 'speech_impairment'),
    ]
    
    for question, options, key in mc_items:
        demo[key] = show_multiple_choice(win, question, options)
    
    if demo['speech_impairment'] == 'yes':
        demo['speech_impairment_explanation'] = show_text_input(
            win, 'Please describe your speech language impairment:')
    else:
        demo['speech_impairment_explanation'] = 'N/A'
    
    experience = show_multiple_choice(
        win,
        'Do you have significant experience communicating with people with speech disorders (e.g., apraxia, dysarthria, stuttering)?',
        ['Yes', 'No']
    )
    demo['experience_with_speech_disorders'] = experience
    
    if experience == 'Yes':
        frequency = show_multiple_choice(
            win,
            'How frequently do you communicate with people with speech disorders?',
            ['never', 'once', 'yearly', 'monthly', 'weekly', 'daily']
        )
        demo['frequency_communication'] = frequency
    else:
        demo['frequency_communication'] = 'N/A'
    
    
    os.makedirs(data_folder, exist_ok = True)
    pd.DataFrame([demo]).to_csv(
        os.path.join(data_folder, f'{participant_id}_demographics.csv'), index = False)
    
    return demo

#################################################
# Stimuli Selection and Speaker Assignment
#################################################
""" 
This section selects the speaker and stimuli for the given participant.

Goals:
Selection of 1 speaker from a list of 4 possible speakers.
Random assignment of the 160 stimuli across the 4 tests.

This chunk will assign the speaker in an offset pattern to counterbalance speakers.
It will then assign a seed value based on the participant_id, which will be used to 
randomize the stimulus at the onset of the first session.
The seed is computed from the participant_id string itself, so the result is identical
on any computer and any launch for the same participant, no file needs to travel 
between sessions. ( just in case a participant is tested on one computer one day 
and another the next)
"""

def get_counterbalanced_speaker(df, group, participant_id):
    """
    Assign speaker deterministically from group offset + participant number.
    Sorted speaker list ensures consistent ordering across machines.
    """
    speakers = sorted(df['spk'].unique())
    
    # Extract the participant number from participant_id (e.g., 'ctrl01' -> 1)
    participant_num = int(''.join(filter(str.isdigit, participant_id)))
    offset = group_offsets.get(group, 0)
    idx = (participant_num - 1 + offset) % len(speakers)
    return speakers[idx]

def get_seed(participant_id):
    return int(hashlib.sha256(participant_id.encode()).hexdigest(), 16) % (2**32)

def assign_test_blocks(test_df, participant_id):
    """
    Shuffle all test sentences once using a seed derived from participant_id,
    then slice into 4 non-overlapping blocks of sentences_per_test.
    """
    
    seed = get_seed(participant_id)
    df_shuffled = test_df.sample(
        frac = 1,
        random_state = seed
    ).reset_index(drop = True)
    
    return {
        'pre-test': df_shuffled.iloc[0:40].to_dict('records'),
        'post-test': df_shuffled.iloc[40:80].to_dict('records'),
        '1-week post': df_shuffled.iloc[80:120].to_dict('records'),
        '1-month post': df_shuffled.iloc[120:160].to_dict('records')
    }

def load_stimuli(filepath, group, participant_id):
    df = pd.read_csv(filepath)
    speaker = get_counterbalanced_speaker(df, group, participant_id)
    spk_df = df[df['spk'] == speaker].copy()
    test_blocks = assign_test_blocks(spk_df[spk_df['type'] == 'test'].copy(),
                                     participant_id)
    
    story_df = spk_df[spk_df['type'] == 'story'].copy()
    return test_blocks, story_df, speaker

###################################
# Story Selection
###################################
"""
Since each group differs in how many and which stories they receive during training,
this chunk is designed to assign stories to each listener based on the group and
session IDs. 

ctrl group = no stories, skips this section
lmtd group = 2 stories in one session (story2 [caterpillar] and story3 [snowball])
mass group = all 4 stories, repeated (8 total stories)
dist group = 2 stories per session, determined based on dist_stories list above
"""

def select_training_stories(story_df, group, session):
    """
    Return (story_subset_df, repeat) for this group x session.
    repeat = True signals run_training_block to loop through stories twice (mass group).
    Returns (empty DataFrame, False) for sessions with no training (control group).
    """
    
    if group == 'lmtd' and session == 'pre-train-post':
        chosen = ['story2', 'story3']
        return story_df[story_df[story_id_col].isin(chosen)].copy(), False
    elif group == 'mass' and session == 'pre-train-post':
        return story_df.copy(), True 
    elif group == 'dist' and session in dist_stories:
        chosen = dist_stories[session]
        return story_df[story_df[story_id_col].isin(chosen)].copy(), False
    
    return pd.DataFrame(), False

###################################
# Run Test Block
###################################
"""
This code chunk sets up a testing block.
It will play the sentences with a fixation cross on the screen.
When the audio is finished playing, it'll allow the participant to type what they heard.
I've set this up to use some punctuation, but anything requiring two-key presses 
(e.g., capital letters, quotes) won't be do-able.

The save_test_results() function below will save as each test finishes.
The next tests' results will be appended below. If it can't find a document to append
to, it'll create one and append the results.
"""
def run_test_block(win, trials, audio_folder, participant_id, session, label):
    """
    Play sentences_per_test sentences; collect typed responses.
    label: 'pre-test' or 'post-test' - record in output CSV.
    """
    show_message(win,
        "You are going to hear short sentences spoken by someone with a "
        "motor speech disorder.\n\n"
        "The sentences contain real English words but will not make sense.\n"
        "Listen carefully — you will hear each sentence only once.\n\n"
        "After each sentence, type what you heard. Make your best guess. "
        "Use 'X' if you have no idea.\n\n"
        "Press SPACE to begin.")
    
    fixation = visual.TextStim(win, text = '+', height = 0.1, color = 'white')
    
    results = []
    for i, trial in enumerate(trials, start = 1):
        # show fixation cross while audio is playing
        fixation.draw()
        win.flip()
        
        # Play audio during fixation
        stim = sound.Sound(os.path.join(audio_folder, trial[audio_file_col]))
        stim.play()
        core.wait(stim.getDuration())
        
        # Audio finished - now flip to response prompt
        response = show_text_input(
            win, f"Please type what you heard below.")
        
        results.append({
            'participant_id': participant_id,
            'session': session,
            'test_label': label,
            'trial_num': i,
            audio_file_col: trial[audio_file_col],
            'spk': trial['spk'],
            'target': trial.get('target', ''),
            'response': response,
            'timestamp': datetime.now().isoformat(),
        })
    return results

def save_test_results(results, participant_id):
    os.makedirs(data_folder, exist_ok = True)
    path = os.path.join(data_folder, f'{participant_id}_test_results.csv')
    write_header = not os.path.exists(path)
    pd.DataFrame(results).to_csv(path, mode = 'a', header = write_header, index = False)

##########################
# Training block
##########################

"""
Sets up the training detailed instructions and format.
First time through, the passage should be joined with subtitles.
Second time through, the sentence plays with fixation cross, then the participant
types out what they thought they heard.

Note: as of right now, what the participant writes down during training is not 
recorded or saved to a csv file. If we care about that information, we'll want to 
add in a way to store it here.

"""

def get_training_instructions(group, session):
    """
    Return the full instruction string shown once at the start of training block.
    Day number for dist is inferred from the session label.
    """
    pd_context = (
        "The person you have been listening to has Parkinson's disease, which "
        "makes their speech difficult to understand. People with Parkinson's "
        "disease often find it challenging to improve their speech so that "
        "other people can better understand them. This can make conversations "
        "with friends, family, and community members difficult and lead to "
        "loneliness and depression. We believe we can improve your ability to "
        "understand this person with some training with their speech. If this "
        "works, clinicians could provide an alternative approach for improving "
        "communication by training communication partners to better understand "
        "the speech."
    )
    
    task_instructions = (
        "Task Instructions \n\n"
        "You will now hear the individual read a short passage twice. "
        "The first time you hear the passage, written subtitles of what the "
        "speaker is saying will be provided on the screen. Your task is to "
        "listen closely to the passage and use the written subtitles to help "
        "you understand what is being said. In the first pass through, you "
        "will not need to type a response, but you do need to listen very "
        "carefully. When you are finished listening, press SPACE to move to "
        "the next sentence. The second time the passage plays, you will not "
        "be provided subtitles. Instead, you will be asked to type what you "
        "heard. Do not worry about punctuation when typing your response. "
        "This process will repeat for the next passage."
    )
    
    if group in ('lmtd', 'mass'):
        return[
            "Now you will begin the training portion of this experiment.\n\n",
            pd_context,
            task_instructions
        ]
    elif group == 'dist':
        day_num = int(''.join(filter(str.isdigit, session)))
        
        if day_num == 1:
            intro = (
                "Welcome to day 1 of training!\n\n"
            )
        else:
            intro = (
                f"Welcome back to day {day_num} of training!\n\n"
                "In this training, you'll be listening to the same speaker "
                "as the previous training session, but they will be reading "
                "different passages."
            )
        if day_num > 1:
            task_instructions = task_instructions.replace(
                "Task Instructions\n\n"
                "You will now hear",
                "Task Instructions\n\n"
                "The task itself is the same as the previous day of training. "
                "You will hear"
            )
        return [
            intro,
            pd_context,
            task_instructions
        ]
    
    return []

def run_training_story(win, story_rows, story_name, audio_folder):
    """
    Single story - two passes:
        Pass 1: Audio + Subtitle, SPACE to advance each sentence.
        Pass 2: Audio only, participant types response (not saved).
    No instructions shown here - those are shown once before the block starts.
    """
    rows = story_rows.to_dict('records')
    
    # Pass 1: Audio + Subtitles
    show_message(win,
        f"Listen carefully and read along with the subtitles.\n\n"
        "Press SPACE to begin.")
    
    subtitle_stim = visual.TextStim(win,
                                    text = '',
                                    pos = [0, 0.1],
                                    height = 0.05, 
                                    color = 'white',
                                    wrapWidth = 0.85)
    hint_stim = visual.TextStim(win,
                                text = 'Press SPACE to move to the next sentences.',
                                pos = [0, -0.35],
                                height = 0.03,
                                color = 'gray')
    
    for row in rows:
        stim = sound.Sound(os.path.join(audio_folder, row[audio_file_col]))
        subtitle_stim.text = row.get(subtitle_col, '')
        subtitle_stim.draw()
        win.flip()
        stim.play()
        core.wait(stim.getDuration() + 0.1)
        
        hint_stim.draw()
        subtitle_stim.draw()
        win.flip()
        
        keys = event.waitKeys(keyList = ['space', 'escape'])
        if 'escape' in keys:
            win.close()
            core.quit()
    
    # Pass 2: Audio only + typed response (unsaved) 
    show_message(win,
        "Now you will hear the same passage again, but this time without subtitles.\n\n"
        "After each sentence, type what you heard and press ENTER.\n\n"
        "Press SPACE to begin.")
    
    fixation = visual.TextStim(win, text = '+', height = 0.1, color = 'white')
    
    for i, row in enumerate(rows, start = 1):
        # show fixation cross while audio is playing
        fixation.draw()
        win.flip()
        
        # play audio
        stim = sound.Sound(os.path.join(audio_folder, row[audio_file_col]))
        stim.play()
        core.wait(stim.getDuration() + 0.15)
        
        # show the text input
        show_text_input(
            win,
            f"Please type what you heard below.")
        # response is not stored since we aren't interested in assessing these

def run_training_block(win, story_df, audio_folder, group, session, repeat = False):
    """
    Show full instructions once, then iterate over stories.
    If repeat = True (mass group), loops through all stories twice.
    """
    if story_df.empty:
        return
    
    # Full instructions show up once at the top
    pages = get_training_instructions(group, session)
    for page in pages:
        show_message(win, page)
    
    stories = sorted(story_df[story_id_col].unique())
    n_passes = 2 if repeat else 1
    
    for _ in range(n_passes):
        for story_name in stories:
            run_training_story(
                win,
                story_df[story_df[story_id_col] == story_name],
                story_name,
                audio_folder
            )

################################
# Main Experiment Loop:
################################

"""
Putting it all together now. This runs through each piece described above (where
applicable). 
"""

def run_experiment():
    # 1. Dialogue Box
    participant_id, group, session = run_dialogue()
    
    # 2. Demographics
    first_sessions = ('pre-post', 'pre-train-post', 'pre-test')
    if session in first_sessions:
        show_demographic_survey(win, participant_id)
    
    #3. Load Stimuli
    test_blocks, story_df, speaker = load_stimuli(stimuli_csv, group, participant_id)
    
    # 4. Select training stories
    training_df, repeat = select_training_stories(story_df, group, session)
    
    # 5. Run session
    if session == 'pre-post':
        #ctrl: pre-test -> post-test, no training
        results = run_test_block(win, test_blocks['pre-test'],
                                audio_folder, participant_id, session, 'pre-test')
        save_test_results(results, participant_id)
        # Break screen - dissmissed by experimenter pressing Q
        show_message(win,
                    "You've completed part 1. Please take a 5 minute break.\n\n"
                    "The experiment will continue when the researcher is ready.")
        results = run_test_block(win, test_blocks['post-test'],
                                audio_folder, participant_id, session, 'post-test')
        save_test_results(results, participant_id)
    
    elif session == 'pre-train-post':
        # lmtd / mass: pre-test -> training -> post-test
        results = run_test_block(win, test_blocks['pre-test'],
                                audio_folder, participant_id, session, 'pre-test')
        save_test_results(results, participant_id)
        
        run_training_block(win, training_df, audio_folder, group = group, session = session, repeat=repeat)
        
        results = run_test_block(win, test_blocks['post-test'], 
                                audio_folder, participant_id, session, 'post-test')
        save_test_results(results, participant_id)
    
    elif session == 'pre-test':
        # dist day 1: pre-test only
        results = run_test_block(win, test_blocks['pre-test'],
                                audio_folder, participant_id, session, 'pre-test')
        save_test_results(results, participant_id)
    
    elif session in ('train-day1', 'train-day2', 'train-day3'):
        # dist days 2-4: training only
        run_training_block(win, training_df, audio_folder, group = group, session = session, repeat = False)
    
    elif session == 'train-day4-post':
        # dist day 5: training -> post-test
        run_training_block(win, training_df, audio_folder, group = group, session = session, repeat = False)
        
        results = run_test_block(win, test_blocks['post-test'],
                                audio_folder, participant_id, session, 'post-test')
        save_test_results(results, participant_id)
    
    elif session in ('1-week post', '1-month post'):
        # All groups: follow-up test only
        results = run_test_block(win, test_blocks[session],
                                audio_folder, participant_id, session, session)
        save_test_results(results, participant_id)
    
    # 6. Wrap up
    show_message(win,
                "That's the end of this session - thank you!\n\n"
                "Please let the researcher know you have finished. \n\n"
                "Press SPACE to exit.")
    win.close()
    core.quit()

run_experiment()

