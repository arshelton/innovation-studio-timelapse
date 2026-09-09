import { defineConfig } from "vite";

import react from "@vitejs/plugin-react";

function determineBasePath(): string {
  if (!process.env.GITHUB_ACTIONS) {
    return "/";
  }

  const repository = process.env.GITHUB_REPOSITORY;

  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is not defined.");
  }

  const repositoryName = repository.split("/")[1];

  if (!repositoryName) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${repository}`);
  }

  /*
   * A repository named username.github.io is hosted
   * at the domain root. Other repositories are hosted
   * beneath /repository-name/.
   */
  if (repositoryName.endsWith(".github.io")) {
    return "/";
  }

  return `/${repositoryName}/`;
}

export default defineConfig({
  plugins: [react()],
  base: determineBasePath(),
});
