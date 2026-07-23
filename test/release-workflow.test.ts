import { expect, test } from "bun:test";

const workflow = await Bun.file(
  new URL("../.github/workflows/release.yml", import.meta.url),
).text();

test("release workflow mints a GitHub App token", () => {
  expect(workflow).toContain("uses: actions/create-github-app-token@v2");
  expect(workflow).toContain("id: app-token");
});

test("release workflow uses its app token for repository writes", () => {
  expect(workflow).toContain("token: ${{ steps.app-token.outputs.token }}");
  expect(workflow).toContain("GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}");
});
