import { SharedArray } from "k6/data";

// load the sessions from the seeded data
const cookies = new SharedArray("sessions", () => JSON.parse(open("../.output/sessions.json")));
