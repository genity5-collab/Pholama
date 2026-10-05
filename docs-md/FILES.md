# Send files and pictures

Tap the **paperclip** next to the message box to attach a file. You can also drag a file onto the chat, or paste a picture.
You can attach up to **4 files** at a time. Tap the **x** on a file to remove it before sending.

## What you can send

| File | Works with | What happens |
|---|---|---|
| Text and code: `.txt` `.md` `.csv` `.json` `.log` `.lua` `.luau` `.py` `.js` `.ts` `.html` `.css` `.xml` `.yml` `.sql` and more | **Every model** | The text is added to your message, so the model can read it |
| Pictures: PNG, JPG, WebP, GIF (up to 8 MB) | Models that can see pictures, or any model once you have the **image reader** | The picture is read into words first, then the model answers |

Not supported: PDFs, Word files, zip files, programs, and SVG. If you pick one, Pholama tells you why and sends nothing.

## Send a picture (the two-model pair)

A small chat model cannot see pictures by itself. So Pholama uses two:

1. **Reader: SmolVLM 256M** (~190 MB). It looks at the picture and writes down what it sees, including any text or numbers.
2. **Brain:** any chat model you already have on your PC. It answers you using what the reader saw.

The reader is about 190 MB. It downloads the first time you attach a picture, then stays saved.

Example: take a photo of a maths question, attach it and type *Solve it*. The reader reads `17 + 25 = ?`, the brain answers `42`.

## What to expect

- The reader is tiny. It reads **clear text and numbers well** and gives a **short, simple description** of a scene. It can get colours and small details wrong.
- The reader looks at each picture in a second or two.
- A text file longer than about 6,000 characters is cut, and the message says how much was kept.
- If a model cannot read pictures and the reader is not installed, Pholama says so instead of guessing.

## Privacy

Files and pictures are read **on your device**. Nothing is uploaded.

## For developers

The logic lives in `web/attach.js` (what a model accepts, how files become a prompt), `web/reader.js` (loads SmolVLM with transformers.js) and `web/attachui.js` (the paperclip and file chips). A model can declare `"accepts": ["text","image"]` in `models.json` to say it reads pictures itself.
