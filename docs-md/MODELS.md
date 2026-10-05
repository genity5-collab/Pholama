# Which model should I pick?

Models run on your **PC** only. Phone and in-browser models are no longer supported; on a phone use Agent Max, or open your own PC app over your network.

[Back to start](../README.md)

Open the app, click **Models**, and it marks what fits your PC. This page is the full list.

## On a PC

| Model | Download | RAM needed | Good for |
|---|---|---|---|
| Qwen2.5 0.5B | 0.4 GB | 2 GB | Chat, Fast |
| Llama 3.2 1B | 0.8 GB | 4 GB | Chat, Summaries |
| Qwen2.5 1.5B | 1.1 GB | 4 GB | Chat, Many languages, Tool use |
| Llama 3.2 3B | 2.0 GB | 8 GB | Chat, Summaries, Tool use |
| Qwen2.5 7B | 4.7 GB | 12 GB | Chat, Many languages, Tool use, Code, Reasoning |
| Llama 3.1 8B | 4.9 GB | 12 GB | Chat, Tool use, Code, Reasoning |
| Qwen2.5 14B | 9.0 GB | 24 GB | Chat, Many languages, Tool use, Code, Reasoning |

Models with **Thinks** show their thinking live before the answer.

## Which PC models can run tools?

On the PC list every model shows a label.

- **Runs tools**: Llama 3.2 3B, Qwen2.5 3B, Granite 4.2 3B, Phi-4 Mini, Mistral 7B, Qwen2.5 7B, Ministral 8B, Hermes 3 8B, Llama 3.1 8B, Granite 3 and 3.1 8B, Qwen3 8B, Mistral Nemo 12B, Qwen2.5 14B, GPT-OSS 20B, Mistral Small 24B.
- **Basic tools only**: Qwen2.5 1.5B and Qwen3 0.6B. Pholama guides them for Studio builds and edits, but they are not a real agent.
- **Chat only**: every other model.

The smallest model that really runs tools is Llama 3.2 3B (1.9 GB, 4 GB RAM).


## Picture reader and Duo

- **Picture reader (SmolVLM 256M, ~190 MB).** It downloads by itself the first time you attach a picture, then stays on your PC. It turns the picture into words so any chat model can answer about it.
- **Duo.** The switch at the top of **Models** lets a small helper AI write hints before the main AI answers. It is a speed option, not an accuracy boost, and it can always be switched off. See [Duo](../README.md#duo-two-local-ais-working-together).
- **Memory.** The website keeps up to 5 memories and the PC app up to 15.
