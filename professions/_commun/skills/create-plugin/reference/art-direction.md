# How a plugin's tab must look and read

BytNode-AI has one look, and a plugin's tab is part of the app, not a website inside it. The user must not be able to tell a tab you wrote from a shipped one. The kit gives you the pieces; these rules say how to use them.

## The look

- **The backdrop is the app's.** The page is transparent: the app's night-blue beams show through. Never paint a background on `body`, never add a frame, a card with a shadow, a gradient behind content.
- **One layer per place.** The left column is a light veil (`bn-side`), the right one a single denser sheet (`bn-sheet`). Nothing laid over them: no boxes inside boxes.
- **Figures sit on tiles.** Numbers go in `bn-tiles` — square tiles parted by 2 px, one block whose outer corners only are round. Not in sentences, not in cards.
- **The metal ink is for the sheet's title only** (`bn-title`). Everything else is the label colours.
- **Colour belongs to the data.** Green and red (`is-up`, `is-down`, `bn-pill`) only for a rise and a fall. Blue for a link or the focus. No decorative colour, no coloured headings, no emoji, no icons for decoration.
- **LIVE / TESTNET / PAPER** (`bn-badge`) on every account and every figure about an account: the user must never wonder whether money is real.
- **Round buttons are circles** (`bn-icon`); text buttons are pills (`bn-button`); one primary button per place at most.
- **Density of a financial app**: compact, aligned on the sheet's margin, figures in tabular digits. No huge hero, no centred marketing layout.

## The words

- **Sentence case** everywhere; never ALL CAPS, never Title Case For Headings.
- **Plain, short, active**: "Add a dividend", not "Submit"; a button says exactly what it does, and the same action keeps the same name everywhere.
- **Speak about their things**: "Your dividends", "Next payment", not "Dividend data management".
- **An empty place invites to act** (`bn-empty`): what is missing and the button that fills it — "No dividend yet. Add the first one to see its payments."
- **An error says what happened and what to do**, without apologising: "The dividend API did not answer. Try again in a minute."
- **Numbers carry their unit and their date** when it matters: "$1.00 a year", "at today's price", "updated 14:02".
- English, like the rest of the app.

## Before you activate, look at it as the user will

- The empty state (a new user has nothing yet).
- A long name, a big number, a negative number.
- Both themes (the kit follows the app; do not hard-code a colour).
- A narrow window: the tiles drop to two columns on their own; a table may need fewer columns.
