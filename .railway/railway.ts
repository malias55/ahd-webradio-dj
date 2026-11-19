import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "ahd-dj";
export default defineRailway(() => {
  const ahdDj = service("ahd-dj", {
    source: github("malias55/ahd-webradio-dj", { branch: "main", checkSuites: false }),
    build: { builder: "NIXPACKS" },
    start: "npx prisma db push && npx tsx prisma/seed.ts && npm run start",
    healthcheck: "/api/health",
    healthcheckTimeout: 180,
    replicas: { "europe-west4-drams3a": 1 },
    // Taken over from the former railway.json, which the migration tool does
    // not translate: restart on crash, at most five times; never sleep.
    deploy: { overlapSeconds: 0, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5, sleepApplication: false },
    domains: [{ domain: "radio-dj.doerrschuck.de", port: 3000 }, { domain: "radio.doerrschuck.de", port: 3000 }],
    // Keep the service in its existing canvas group next to Postgres.
    groupId: "ahd-dj",
  });

  return project("ahd-radio", {
    variables: { managed: false },
    resources: [ahdDj],
  });
});
