# Which model should I pick?

[Back to start](../README.md)

Open the app, tap **Models**, and it marks what fits your phone. This page is the full list.

## On a phone WITH a GPU (fast)

Needs Chrome on Android 121+ (or iOS 18+ Safari with WebGPU). The app checks your GPU and uses a compatibility version by itself when needed.


**Any phone**

| Model | Size | Good for |
|---|---|---|
| SmolLM2 360M | ~0.4 GB | Chat, Fast. Smallest and fastest. Simple chat and short answers. |
| Qwen2.5 0.5B | ~0.9 GB | Chat, Many languages. Tiny but handles many languages. |
| Gemma 3 1B | ~0.7 GB | Chat, Writing. Google's small model. Nice clear writing. |
| Llama 3.2 1B | ~0.9 GB | Chat, Summaries. Good all-rounder for any phone. |
| Qwen2.5 Coder 0.5B | ~0.9 GB | Code. Tiny helper for code snippets. |

**Most phones (4 GB+ RAM)**

| Model | Size | Good for |
|---|---|---|
| Qwen3 0.6B (thinks) | ~1.4 GB | Chat, Thinks, Many languages. Shows its thinking before answering. |
| Qwen2.5 1.5B | ~1.6 GB | Chat, Many languages, Tool use. Best small model for following instructions. |
| Qwen2.5 Math 1.5B | ~1.6 GB | Math. Made for math problems. |
| SmolLM2 1.7B | ~1.8 GB | Chat, Writing. Bigger SmolLM2. Needs a phone GPU with f16. |

**Good phones (6 GB+ RAM)**

| Model | Size | Good for |
|---|---|---|
| Qwen3 1.7B (thinks) | ~2.0 GB | Chat, Thinks, Many languages, Tool use. Thinks step by step. Best mid-size pick. |
| Gemma 2 2B | ~1.6 GB | Chat, Writing. Higher quality writing. 6 GB+ RAM phone. |

**Flagship phones (8 GB+ RAM)**

| Model | Size | Good for |
|---|---|---|
| Llama 3.2 3B | ~2.3 GB | Chat, Summaries, Tool use. Strong quality. Flagship phones. |
| Qwen2.5 3B | ~2.5 GB | Chat, Many languages, Tool use, Code. Strong all-rounder. Flagship phones. |
| Phi 3.5 mini | ~2.5 GB | Chat, Reasoning, Code. Good at reasoning. Flagship phones. |
| Qwen3 4B (thinks) | ~3.4 GB | Chat, Thinks, Reasoning, Tool use, Code. Smartest phone model here. 8 GB+ RAM only. |

## On a phone WITHOUT a GPU (slower)

Works in almost any modern browser. Expect a few words per second.

| Model | Size | Good for |
|---|---|---|
| SmolLM2 135M (CPU) | ~0.15 GB | Chat, Fast. Tiniest. For very old phones. Answers are basic. |
| SmolLM2 360M (CPU) | ~0.4 GB | Chat, Fast. Best first pick without a GPU. Slower than GPU. |
| Qwen2.5 0.5B (CPU) | ~0.5 GB | Chat, Many languages. Many languages. Slower than GPU. |
| Qwen3 0.6B (CPU, thinks) | ~0.6 GB | Chat, Thinks, Many languages. Shows its thinking. Slow on CPU. |
| Qwen2.5 1.5B (CPU) | ~1.2 GB | Chat, Many languages, Tool use. Smarter but slow. 4 GB+ RAM. |
| Llama 3.2 1B (CPU) | ~1.0 GB | Chat, Summaries. Good quality but slow. 4 GB+ RAM. |

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

- **Picture reader (SmolVLM 256M, ~190 MB).** It now has its own row at the top of the **In this browser** list in **Models**. Press **Download** once. It lets any chat model work with pictures by reading them into words first. Pair it with Qwen2.5 0.5B (~0.5 GB), about 0.7 GB in total.
- **Duo.** The switch at the top of **Models** lets a small helper AI write hints before the main AI answers. It is a speed option, not an accuracy boost, and it can always be switched off. See [Duo](../README.md#duo-two-local-ais-working-together).
- **Memory.** The website keeps up to 5 memories and the PC app up to 15.
