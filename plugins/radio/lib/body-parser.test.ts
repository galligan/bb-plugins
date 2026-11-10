import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBody } from "./body-parser.ts";

test("address parsing preserves text and reports canonical repairs without confusing refs and audiences", () => {
  const body =
    "@Agent__Name @Pay--Ments:Reviewer @user ch:Pay__Ments/Cut--Over @ch:payments/cut-over #Some__Topic";
  const tokens = parseBody(body);
  assert.deepEqual(
    tokens.map((token) => [token.kind, token.canonical]),
    [
      ["participant", "@agent-name"],
      ["participant", "@pay-ments:reviewer"],
      ["human", "@user"],
      ["channel-reference", "ch:pay-ments/cut-over"],
      ["channel-audience", "@ch:payments/cut-over"],
      ["tag", "#some-topic"],
    ],
  );
  for (const token of tokens)
    assert.equal(body.slice(token.start, token.end), token.original);
  assert.equal(tokens[0]!.corrected, true);
});

test("quotes, code, blockquotes and backslash escapes do not expand recipients", () => {
  const body = [
    "\"@quoted\" '@single' “@curly” ‘@curly-single’ `@code` ``@code-two``",
    "> @blockquote",
    "    @indented-code",
    "```ts",
    "@fenced",
    "```",
    "~~~",
    "@tilde",
    "~~~",
    String.raw`\@escaped \\@active`,
    "don't hide @visible. It's @here: useful. mail@example.com https://site/@path",
  ].join("\n");
  assert.deepEqual(
    parseBody(body).map((token) => token.canonical),
    ["@active", "@visible", "@here"],
  );
  assert.deepEqual(parseBody("`unclosed @literal"), []);
  assert.deepEqual(parseBody("```\n@unclosed-fence"), []);
  assert.deepEqual(
    parseBody("'don't address @hidden' ‘It’s @also-hidden’ @visible").map(
      (token) => token.canonical,
    ),
    ["@visible"],
  );
});

test("malformed address syntax and unmatched quotes refuse partial audience expansion", () => {
  for (const body of [
    "@project:handle:remote",
    "@ch:one/two/three",
    "@agent/path",
    "@agent.name",
    '"@unclosed',
    "@project:user",
    "x".repeat(16_385),
  ])
    assert.throws(() => parseBody(body), body);
});
