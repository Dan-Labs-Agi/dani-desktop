import { describe, expect, it } from "vitest";
import { APP_REPOSITORY, LICENSE_URL, RELEASES_URL, UPSTREAM_REPOSITORY } from "./app-links";

describe("app links", () => {
  it("points the repository, releases and license at this app, and keeps the upstream project as a separate credit", () => {
    expect(APP_REPOSITORY).toBe("https://github.com/somdipto/dani-desktop");
    expect(RELEASES_URL).toBe(`${APP_REPOSITORY}/releases`);
    expect(LICENSE_URL).toBe(`${APP_REPOSITORY}/blob/main/LICENSE`);
    expect(UPSTREAM_REPOSITORY).toBe("https://github.com/milind-soni/OpenMausBot");
    expect(UPSTREAM_REPOSITORY).not.toBe(APP_REPOSITORY);
  });
});
