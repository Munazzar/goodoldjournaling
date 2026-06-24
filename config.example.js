// config.example.js
// Copy this file to `config.js` and fill in your own values.
// `config.js` is in .gitignore — keep it out of version control.

window.GOJ_CONFIG = {
  // Google Cloud Console → APIs & Services → Credentials → API key
  // Restrict it to HTTP referrers (your-username.github.io/*, localhost/*)
  API_KEY: "YOUR_GOOGLE_API_KEY",

  // Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID
  // Add your GitHub Pages URL + http://localhost:* to Authorized JavaScript origins
  CLIENT_ID: "YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com",

  // The visible folder name in your Google Drive. All journal pages live inside.
  DRIVE_FOLDER_NAME: "Good Old Journaling",

  // drive.file is much safer than full drive scope:
  // it only lets the app see files it created itself.
  SCOPES: "https://www.googleapis.com/auth/drive.file",
};
