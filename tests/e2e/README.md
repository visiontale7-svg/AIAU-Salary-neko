# Browser-demo acceptance assumptions

The Playwright suite treats the browser demo as a deterministic stand-in for the
Tauri shell. It must not send a real OpenAI request.

Stable accessibility contract:

- page heading starts with `对话图谱`;
- graph region is labelled `对话关系星图`;
- source search input is labelled `搜索原文`;
- every semantic node is a button whose accessible name includes its label;
- source panel is labelled `原文证据`;
- mode overlays use `data-testid="mode-island"` and an accessible label beginning
  with `AI 推断模式：`;
- correction uses `纠正分析`, an explicitly labelled display-label input
  (`显示标签`; the test also accepts the earlier `修正后的标签` wording), and
  `保存纠正`;
- `?fixture=b5&reset=1` clears demo state while `?fixture=b5` preserves local
  corrections across reloads.

The screenshot baseline is captured at the viewport declared in
`playwright.config.ts` (1536×1024). Mode colors and island geometry may change only
through an intentional snapshot update after visual review.
