const express = require("express");
const cors = require("cors");
const SpotifyWebApi = require("spotify-web-api-node");
const axios = require("axios");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
require("dotenv").config();

// Function to check if a command exists
function commandExists(command) {
  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Function to check prerequisites
async function installPrerequisites() {
  console.log("Checking prerequisites...");

  // Check for yt-dlp
  if (!commandExists("yt-dlp")) {
    console.error("yt-dlp is not installed");
    throw new Error("yt-dlp is not installed");
  } else {
    console.log("yt-dlp is available");
  }

  // Check for ffmpeg
  if (!commandExists("ffmpeg")) {
    console.error("ffmpeg is not installed");
    throw new Error("ffmpeg is not installed");
  } else {
    console.log("ffmpeg is available");
  }
}

// Initialize Express app
const app = express();

// Create downloads directory if it doesn't exist
const downloadsDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

// Middleware
app.use(express.json());
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.CLIENT_URL
        : "http://localhost:3001",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// Initialize Spotify API client with environment variables
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID || "b0ad6d6cea8b4727a4d391ccc8f5c110",
  clientSecret:
    process.env.SPOTIFY_CLIENT_SECRET || "4ed3757cf3914fc5a2ddc4e93c81d781",
});

// Refresh Spotify access token
async function refreshSpotifyToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body["access_token"]);
    console.log("Spotify token refreshed");
  } catch (err) {
    console.error("Error refreshing token:", err);
  }
}

// Refresh token initially and every hour
refreshSpotifyToken();
setInterval(refreshSpotifyToken, 3600000);

// Extract Spotify ID from URL
function extractSpotifyId(url) {
  try {
    const baseUrl = url.split("?")[0];
    if (baseUrl.includes("track/")) {
      return { type: "track", id: baseUrl.split("track/")[1] };
    } else if (baseUrl.includes("playlist/")) {
      return { type: "playlist", id: baseUrl.split("playlist/")[1] };
    } else if (baseUrl.includes("album/")) {
      return { type: "album", id: baseUrl.split("album/")[1] };
    }
  } catch (err) {
    console.error("Error extracting Spotify ID:", err);
  }
  return { type: null, id: null };
}

// Send status update to client
function sendStatus(progressId, status, progress, currentTrack = null) {
  const res = downloadProgressStreams.get(progressId);
  if (res) {
    res.write(
      `data: ${JSON.stringify({ status, progress, currentTrack })}\n\n`
    );
  }
}

// API Routes
app.post("/api/info", async (req, res) => {
  try {
    const { url } = req.body;
    console.log("Received request for URL:", url);

    const { type, id } = extractSpotifyId(url);
    if (!id) {
      return res.status(400).json({ error: "Invalid Spotify URL" });
    }

    let result;
    switch (type) {
      case "track":
        const track = await spotifyApi.getTrack(id);
        result = {
          type: "track",
          info: {
            name: track.body.name,
            artist: track.body.artists[0].name,
            album: track.body.album.name,
            image: track.body.album.images[0]?.url,
          },
        };
        break;

      case "playlist":
        const playlist = await spotifyApi.getPlaylist(id);
        result = {
          type: "playlist",
          name: playlist.body.name,
          tracks: playlist.body.tracks.items.map((item) => ({
            id: item.track.id,
            name: item.track.name,
            artist: item.track.artists[0].name,
            album: item.track.album.name,
          })),
        };
        break;

      case "album":
        const album = await spotifyApi.getAlbumTracks(id);
        result = {
          type: "album",
          tracks: album.body.items.map((track) => ({
            id: track.id,
            name: track.name,
            artist: track.artists[0].name,
          })),
        };
        break;

      default:
        return res.status(400).json({ error: "Invalid content type" });
    }

    res.json(result);
  } catch (err) {
    console.error("Error processing request:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/download", async (req, res) => {
  let ytDlp = null;
  let outputPath = null;

  try {
    const { track_name, artist_name } = req.body;
    console.log("Starting download process for:", { track_name, artist_name });

    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    sendStatus(res, "Searching YouTube...", 0);
    const searchQuery = `${track_name} ${artist_name} audio`;
    const searchResponse = await axios.get(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(
        searchQuery
      )}`
    );

    const match = searchResponse.data.match(/videoId":"([^"]+)"/);
    if (!match) {
      console.log("No matching video found on YouTube");
      throw new Error("No video found");
    }

    const videoId = match[1];
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log("Found video URL:", videoUrl);

    sendStatus(res, "Starting download...", 5);
    const filename = `${track_name}-${Date.now()}.mp3`;
    outputPath = path.join(downloadsDir, filename);
    console.log("Preparing to download to:", outputPath);

    ytDlp = spawn("yt-dlp", [
      "-f",
      "bestaudio",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "--newline",
      "-o",
      outputPath,
      videoUrl,
    ]);

    let error = null;
    let downloadComplete = false;

    ytDlp.stdout.on("data", (data) => {
      const output = data.toString();
      if (output.includes("[download]")) {
        const match = output.match(/(\d+\.?\d*)%/);
        if (match) {
          const progress = parseFloat(match[1]);
          sendStatus(res, "Downloading...", progress);
        }
      } else if (output.includes("[ExtractAudio]")) {
        sendStatus(res, "Converting to MP3...", 95);
      }
      console.log(`yt-dlp output: ${data}`);
    });

    ytDlp.stderr.on("data", (data) => {
      console.error(`yt-dlp error: ${data}`);
      error = data.toString();
    });

    ytDlp.on("close", async (code) => {
      if (code !== 0) {
        console.error(`yt-dlp process exited with code ${code}`);
        if (!res.headersSent) {
          return res.status(500).json({ error: error || "Download failed" });
        }
        return;
      }

      if (!downloadComplete) {
        console.log("Download completed successfully");
        downloadComplete = true;
        sendStatus(res, "Download complete!", 100);

        // Change content type for file download
        res.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": `attachment; filename="${track_name}.mp3"`,
        });

        // Stream the file
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);

        fileStream.on("end", () => {
          // Clean up the file after streaming
          fs.unlink(outputPath, (err) => {
            if (err) {
              console.error("Error deleting file:", err);
            } else {
              console.log("Temporary file deleted successfully");
            }
          });
        });
      }
    });

    // Handle client disconnect or abort
    req.on("close", () => {
      console.log("Client disconnected, cleaning up...");
      if (ytDlp) {
        console.log("Killing yt-dlp process...");
        ytDlp.kill("SIGKILL");
      }
      if (outputPath && fs.existsSync(outputPath)) {
        console.log("Deleting partial download file...");
        fs.unlink(outputPath, (err) => {
          if (err) {
            console.error("Error deleting partial file:", err);
          } else {
            console.log("Partial file deleted successfully");
          }
        });
      }
      if (!res.headersSent) {
        res.end();
      }
    });
  } catch (err) {
    console.error("Download error:", err);
    if (ytDlp) {
      ytDlp.kill("SIGKILL");
    }
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// Add this new endpoint for progress tracking
app.get("/api/download-progress/:id", (req, res) => {
  const progressId = req.params.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Store the response object to send updates
  downloadProgressStreams.set(progressId, res);

  req.on("close", () => {
    downloadProgressStreams.delete(progressId);
  });
});

// Add this at the top with other requires
const downloadProgressStreams = new Map();
const activeDownloads = new Map();
const downloadEndpoints = new Map(); // Track dynamic endpoints

// Add this new endpoint for aborting downloads
app.post("/api/download-playlist/:id/abort", async (req, res) => {
  const progressId = req.params.id;
  console.log(`Received abort request for progress ID: ${progressId}`);

  try {
    // Get and close progress stream
    const progressRes = downloadProgressStreams.get(progressId);
    if (progressRes) {
      console.log(`Closing progress stream for ID: ${progressId}`);
      progressRes.write(
        `data: ${JSON.stringify({
          status: "error",
          error: "Download aborted",
        })}\n\n`
      );
      progressRes.end();
      downloadProgressStreams.delete(progressId);
    }

    // Kill active download processes
    const downloadInfo = activeDownloads.get(progressId);
    if (downloadInfo) {
      console.log(`Killing download processes for ID: ${progressId}`);
      for (const [_, process] of downloadInfo.currentYtDlp.entries()) {
        if (process) {
          process.kill("SIGKILL");
        }
      }
      downloadInfo.isAborted = true;
      activeDownloads.delete(progressId);
    }

    // Remove dynamic endpoint if it exists
    const routeIndex = downloadEndpoints.get(progressId);
    if (routeIndex !== undefined) {
      console.log(`Removing dynamic endpoint for ID: ${progressId}`);
      app._router.stack.splice(routeIndex, 1);
      downloadEndpoints.delete(progressId);
    }

    // Clean up the playlist directory
    const playlistDir = path.join(downloadsDir, `playlist-${progressId}`);
    if (fs.existsSync(playlistDir)) {
      console.log(`Removing playlist directory: ${playlistDir}`);
      await fs.promises.rm(playlistDir, { recursive: true, force: true });
      console.log("Playlist directory removed successfully");
    }

    res.status(200).json({ message: "Download aborted" });
  } catch (err) {
    console.error("Error during abort:", err);
    res.status(500).json({ message: "Error during abort", error: err.message });
  }
});

// Add this helper function for parallel processing
async function processInParallel(items, concurrency, processor) {
  const results = new Array(items.length);
  let currentIndex = 0;

  async function processNext() {
    const index = currentIndex++;
    if (index >= items.length) return;

    results[index] = await processor(items[index], index);
    await processNext();
  }

  // Start initial batch of promises
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => processNext());

  await Promise.all(workers);
  return results;
}

app.post("/api/download-playlist", async (req, res) => {
  let currentYtDlp = null;
  let playlistDir = null;
  const progressId = Date.now().toString();
  const CONCURRENT_DOWNLOADS = 3; // Number of concurrent downloads

  // Create download info object
  const downloadInfo = {
    currentYtDlp: new Map(), // Track multiple yt-dlp processes
    isAborted: false,
    cleanup: async () => {
      if (playlistDir && fs.existsSync(playlistDir)) {
        console.log("Cleaning up playlist directory...");
        try {
          await fs.promises.rm(playlistDir, { recursive: true, force: true });
          console.log("Playlist directory cleaned up successfully");
        } catch (err) {
          console.error("Error cleaning up playlist directory:", err);
        }
      }
      // Close and remove the progress stream
      const progressRes = downloadProgressStreams.get(progressId);
      if (progressRes) {
        progressRes.end();
        downloadProgressStreams.delete(progressId);
      }
      // Remove from active downloads
      activeDownloads.delete(progressId);
    },
  };
  activeDownloads.set(progressId, downloadInfo);

  try {
    const { tracks, playlistName } = req.body;
    const totalTracks = tracks.length;
    let completedTracks = 0;
    const trackProgress = new Map();

    // Create a temporary directory for the playlist
    playlistDir = path.join(downloadsDir, `playlist-${progressId}`);
    await fs.promises.mkdir(playlistDir, { recursive: true });

    // Create zip archive
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("warning", (err) => console.warn("Archive warning:", err));
    archive.on("error", (err) => {
      throw err;
    });

    // Create write stream for the zip file
    const zipPath = path.join(playlistDir, `${playlistName || "playlist"}.zip`);
    const output = fs.createWriteStream(zipPath);

    // Return the progress ID immediately
    res.json({ progressId });

    archive.pipe(output);

    // Process tracks in parallel while maintaining order
    const downloadTrack = async (track, index) => {
      if (downloadInfo.isAborted) return null;

      try {
        console.log(
          `Processing track ${index + 1}/${totalTracks}: ${track.name}`
        );

        sendStatus(
          progressId,
          "Processing track...",
          (completedTracks / totalTracks) * 100,
          {
            name: track.name,
            current: index + 1,
            total: totalTracks,
          }
        );

        const searchQuery = `${track.name} ${track.artist} audio`;
        const searchResponse = await axios.get(
          `https://www.youtube.com/results?search_query=${encodeURIComponent(
            searchQuery
          )}`
        );

        const match = searchResponse.data.match(/videoId":"([^"]+)"/);
        if (!match) {
          console.log(`No YouTube match found for: ${track.name}`);
          return null;
        }

        const videoId = match[1];
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const outputPath = path.join(playlistDir, `${index}-${track.name}.mp3`);

        // Download track
        await new Promise((resolve, reject) => {
          const ytDlp = spawn("yt-dlp", [
            "-f",
            "bestaudio",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "--newline",
            "-o",
            outputPath,
            videoUrl,
          ]);

          // Track this process
          downloadInfo.currentYtDlp.set(index, ytDlp);
          trackProgress.set(index, 0);

          let downloadProgress = 0;
          let errorOutput = "";

          ytDlp.stdout.on("data", (data) => {
            if (downloadInfo.isAborted) return;
            const output = data.toString();
            if (output.includes("[download]")) {
              const match = output.match(/(\d+\.?\d*)%/);
              if (match) {
                downloadProgress = parseFloat(match[1]);
                trackProgress.set(index, downloadProgress);

                // Calculate total progress across all tracks
                const totalProgress =
                  Array.from(trackProgress.values()).reduce(
                    (sum, progress) => sum + progress,
                    0
                  ) / totalTracks;
                sendStatus(progressId, "Downloading...", totalProgress, {
                  name: track.name,
                  current: index + 1,
                  total: totalTracks,
                });
              }
            } else if (output.includes("[ExtractAudio]")) {
              sendStatus(
                progressId,
                "Converting to MP3...",
                ((completedTracks + 0.95) / totalTracks) * 100,
                {
                  name: track.name,
                  current: index + 1,
                  total: totalTracks,
                }
              );
            }
          });

          ytDlp.stderr.on("data", (data) => {
            errorOutput += data.toString();
          });

          ytDlp.on("close", (code) => {
            downloadInfo.currentYtDlp.delete(index);
            if (downloadInfo.isAborted) {
              reject(new Error("Download aborted"));
              return;
            }

            if (code === 0 && fs.existsSync(outputPath)) {
              completedTracks++;
              resolve(outputPath);
            } else {
              reject(
                new Error(`Download failed (code ${code}): ${errorOutput}`)
              );
            }
          });
        });

        return { path: outputPath, name: track.name, index };
      } catch (error) {
        console.error(`Error processing track ${track.name}:`, error);
        if (error.message === "Download aborted") throw error;
        return null;
      }
    };

    // Process tracks in parallel while maintaining order
    const results = await processInParallel(
      tracks,
      CONCURRENT_DOWNLOADS,
      downloadTrack
    );

    if (!downloadInfo.isAborted) {
      sendStatus(progressId, "Creating zip file...", 95);

      // Add files to archive in correct order
      for (const result of results.filter((r) => r !== null)) {
        archive.file(result.path, { name: `${result.name}.mp3` });
      }

      await archive.finalize();

      // Create the download endpoint
      const downloadRoute = `/api/download-playlist/${progressId}`;
      app.get(downloadRoute, async (downloadReq, downloadRes) => {
        sendStatus(progressId, "Starting download...", 100);
        downloadRes.download(
          zipPath,
          `${playlistName || "playlist"}.zip`,
          async (err) => {
            if (err) {
              console.error("Error sending file:", err);
            }
            await downloadInfo.cleanup();

            // Remove the dynamic endpoint safely
            const routeIndex = downloadEndpoints.get(progressId);
            if (routeIndex !== undefined) {
              app._router.stack.splice(routeIndex, 1);
              downloadEndpoints.delete(progressId);
            }
          }
        );
      });

      // Store the index of the newly added route
      const routeIndex = app._router.stack.length - 1;
      downloadEndpoints.set(progressId, routeIndex);

      // Send the download URL
      const progressRes = downloadProgressStreams.get(progressId);
      if (progressRes) {
        progressRes.write(
          `data: ${JSON.stringify({
            status: "ready",
            downloadUrl: downloadRoute,
          })}\n\n`
        );
      }
    }
  } catch (err) {
    console.error("Playlist download error:", err);
    downloadInfo.isAborted = true;

    // Kill all active download processes
    for (const [index, process] of downloadInfo.currentYtDlp.entries()) {
      process.kill("SIGKILL");
    }
    downloadInfo.currentYtDlp.clear();

    await downloadInfo.cleanup();
    const progressRes = downloadProgressStreams.get(progressId);
    if (progressRes && !progressRes.headersSent) {
      progressRes.write(
        `data: ${JSON.stringify({ status: "error", error: err.message })}\n\n`
      );
      progressRes.end();
    }
  }
});

// Add this after other middleware setup
if (process.env.NODE_ENV === "production") {
  // Serve static files from the React build directory
  app.use(express.static(path.join(__dirname, "client/build")));

  // Handle React routing, return all requests to React app
  app.get("*", function (req, res) {
    res.sendFile(path.join(__dirname, "client/build", "index.html"));
  });
}

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await installPrerequisites();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();
