import pkg from "../../package.json";
import { censusIdentity } from "@/lib/census";
import { feedbackMode, githubIssueHref, type FeedbackSetup } from "@/lib/feedback";

/** Modus und GitHub-Link des Feedback-Knopfs — serverseitig, weil die Census-ID aus dem
 *  `NEXTAUTH_SECRET` folgt und der Browser es nie sieht. */
export function feedbackSetup(): FeedbackSetup {
  return {
    mode: feedbackMode(),
    githubHref: githubIssueHref({ version: pkg.version, ...censusIdentity() }),
  };
}
