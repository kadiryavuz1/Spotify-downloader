const express = require("express");
const cors = require("cors");
const SpotifyWebApi = require("spotify-web-api-node");
const axios = require("axios");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
require("dotenv").config();
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");
const os = require("os");

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
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    credentials: true,
  })
);

// Serve static files from React build
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));

  // Handle React routing, return all requests to React app
  app.get("*", function (req, res) {
    res.sendFile(path.join(__dirname, "../client/build", "index.html"));
  });
}

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
    // Remove any query parameters
    const urlWithoutParams = url.split("?")[0];

    // Extract the type and ID
    if (urlWithoutParams.includes("track/")) {
      return { type: "track", id: urlWithoutParams.split("track/")[1] };
    } else if (urlWithoutParams.includes("playlist/")) {
      return { type: "playlist", id: urlWithoutParams.split("playlist/")[1] };
    } else if (urlWithoutParams.includes("album/")) {
      return { type: "album", id: urlWithoutParams.split("album/")[1] };
    }
  } catch (err) {
    console.error("Error extracting Spotify ID:", err);
  }
  return { type: null, id: null };
}

// Update the sendStatus function to include better error handling and logging
function sendStatus(progressId, status, progress, currentTrack = null) {
  const res = downloadProgressStreams.get(progressId);
  if (!res || res.writableEnded) {
    console.log(`No active stream for progress ID: ${progressId}`);
    return;
  }

  try {
    // Structure the data to match the component's expectations
    const progressData = {
      status,
      progress: progress || 0,
      currentTrack: {
        currentTrack: currentTrack?.currentTrack || null,
        totalTracks: currentTrack?.totalTracks || null,
        name: currentTrack?.name || null,
      },
    };

    const data = `data: ${JSON.stringify(progressData)}\n\n`;
    console.log(`Sending status update for ${progressId}:`, data);

    // Send the data without using flush
    res.write(data);
  } catch (error) {
    console.error(`Error sending status update for ${progressId}:`, error);
  }
}

// Function to get all tracks from a playlist
async function getAllPlaylistTracks(playlistId) {
  let tracks = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const response = await spotifyApi.getPlaylistTracks(playlistId, {
      offset: offset,
      limit: limit,
      fields: "items(track(id,name,artists,album(name))),total",
    });

    const items = response.body.items.filter((item) => item.track);
    tracks = tracks.concat(
      items.map((item) => ({
        id: item.track.id,
        name: item.track.name,
        artist: item.track.artists[0].name,
        album: item.track.album.name,
      }))
    );

    if (response.body.items.length < limit) break;
    offset += limit;
  }

  return tracks;
}

// API Routes
app.post("/api/info", async (req, res) => {
  try {
    const { url } = req.body;
    console.log("Received request for URL:", url);

    // Ensure we have a valid token before proceeding
    await refreshSpotifyToken();

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
        // Check if it's an official Spotify playlist
        if (playlist.body.owner.id === "spotify") {
          throw new Error(
            "Only playlists created by users are supported. Official Spotify playlists or radios will not work."
          );
        }
        const tracks = await getAllPlaylistTracks(id);
        result = {
          type: "playlist",
          name: playlist.body.name,
          tracks: tracks,
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
    // Check if token expired and retry once
    if (err.statusCode === 401) {
      try {
        await refreshSpotifyToken();
        // Retry the request
        const { type, id } = extractSpotifyId(req.body.url);
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
            // Check if it's an official Spotify playlist in retry as well
            if (playlist.body.owner.id === "spotify") {
              throw new Error(
                "Only playlists created by users are supported. Official Spotify playlists or radios will not work."
              );
            }
            const tracks = await getAllPlaylistTracks(id);
            result = {
              type: "playlist",
              name: playlist.body.name,
              tracks: tracks,
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
        }
        return res.json(result);
      } catch (retryErr) {
        console.error("Error after token refresh:", retryErr);
        return res.status(500).json({ error: retryErr.message });
      }
    }
    res.status(500).json({ error: err.message });
  }
});

// Update the getYtDlpArgs function
const getYtDlpArgs = (format, resolution = null) => {
  return [
    "--format",
    format === "audio"
      ? "bestaudio/best"
      : `bestvideo[height<=${resolution}]+bestaudio/best[height<=${resolution}]/best`,
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "--no-check-certificate",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "--referer",
    "https://www.youtube.com/",
    "--add-header",
    "Accept-Language:en-US,en;q=0.9",
    "--add-header",
    "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "--add-header",
    "Accept-Encoding:gzip, deflate, br",
    "--add-header",
    "DNT:1",
    "--add-header",
    "Upgrade-Insecure-Requests:1",
    "--sleep-interval",
    "5",
    "--max-sleep-interval",
    "10",
    "--geo-bypass",
    "--no-playlist",
    "--ignore-errors",
    "--no-warnings",
    "--cookies-from-browser",
    "chrome",
    "--extractor-args",
    "youtube:player_client=android",
    "--quiet",
  ];
};

// Update the download function
app.post("/api/download", async (req, res) => {
  let ytDlp = null;
  let outputPath = null;
  let retryCount = 0;
  const MAX_RETRIES = 5; // Increased retries for free proxies

  const downloadWithRetry = async () => {
    try {
      const { track_name, artist_name } = req.body;
      console.log("Starting download process for:", {
        track_name,
        artist_name,
      });

      const searchQuery = `${track_name} ${artist_name}`;
      const ytDlpArgs = getYtDlpArgs("audio");

      const videoUrl = await new Promise((resolve, reject) => {
        const ytDlpSearch = spawn("yt-dlp", [
          ...ytDlpArgs,
          "ytsearch1:" + searchQuery,
          "--get-id",
        ]);

        let videoId = "";
        let error = "";

        ytDlpSearch.stdout.on("data", (data) => {
          videoId += data.toString().trim();
        });

        ytDlpSearch.stderr.on("data", (data) => {
          error += data.toString();
        });

        ytDlpSearch.on("close", (code) => {
          if (code === 0 && videoId) {
            resolve(`https://www.youtube.com/watch?v=${videoId}`);
          } else {
            reject(new Error(`Search failed: ${error}`));
          }
        });
      });

      // Sanitize filename for filesystem
      const sanitizedName = track_name.replace(/[^a-zA-Z0-9]/g, "_");
      const filename = `${sanitizedName}-${Date.now()}.mp3`;
      outputPath = path.join(downloadsDir, filename);
      console.log("Preparing to download to:", outputPath);

      // Download the file completely before sending
      await new Promise((resolve, reject) => {
        ytDlp = spawn("yt-dlp", [
          "-f",
          "bestaudio",
          "-x",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
          "-o",
          outputPath,
          videoUrl,
        ]);

        let error = "";

        ytDlp.stdout.on("data", (data) => {
          console.log(`yt-dlp output: ${data}`);
        });

        ytDlp.stderr.on("data", (data) => {
          console.error(`yt-dlp error: ${data}`);
          error += data.toString();
        });

        ytDlp.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Download failed with code ${code}: ${error}`));
          }
        });
      });

      // Check if file exists and has size
      if (!fs.existsSync(outputPath)) {
        throw new Error("Download failed - file not created");
      }

      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        throw new Error("Download failed - file is empty");
      }

      console.log("Download completed successfully");

      // Read the file into memory
      const fileBuffer = await fs.promises.readFile(outputPath);

      // Delete the file immediately after reading
      await fs.promises.unlink(outputPath);
      console.log("File deleted after reading into memory");

      // Set headers
      res.set({
        "Content-Type": "audio/mpeg",
        "Content-Length": fileBuffer.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          track_name
        )}.mp3`,
      });

      // Send the file from memory
      res.send(fileBuffer);
    } catch (err) {
      console.error(`Download attempt ${retryCount + 1} failed:`, err);
      if (retryCount < MAX_RETRIES && err.message.includes("HTTP Error 429")) {
        retryCount++;
        console.log(`Retrying download (attempt ${retryCount + 1})...`);
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryCount) * 1000)
        );
        return downloadWithRetry();
      }
      throw err;
    }
  };

  try {
    await downloadWithRetry();
  } catch (err) {
    console.error("All download attempts failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Update the progress tracking endpoint
app.get("/api/download-progress/:id", (req, res) => {
  const progressId = req.params.id;

  // Set headers for SSE with proper CORS and caching headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin":
      process.env.NODE_ENV === "production"
        ? process.env.CLIENT_URL
        : "http://localhost:3001",
    "Access-Control-Allow-Credentials": "true",
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ status: "connected" })}\n\n`);

  // Keep connection alive with more frequent updates
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": keepalive\n\n");
    } else {
      clearInterval(keepAlive);
    }
  }, 10000);

  // Store the response object and interval in the map
  downloadProgressStreams.set(progressId, res);

  // Handle client disconnect
  req.on("close", () => {
    clearInterval(keepAlive);
    downloadProgressStreams.delete(progressId);
    console.log(`Client disconnected for progress ID: ${progressId}`);
  });

  // Handle errors
  req.on("error", (error) => {
    console.error(`Error in progress stream for ${progressId}:`, error);
    clearInterval(keepAlive);
    downloadProgressStreams.delete(progressId);
  });
});

// Add this at the top with other requires
const downloadProgressStreams = new Map();
const activeDownloads = new Map();
const downloadEndpoints = new Map(); // Track dynamic endpoints

// Add this helper function for parallel processing
async function processTracksInParallel(
  tracks,
  playlistDir,
  progressId,
  maxConcurrent = 3
) {
  const batchSize = Math.min(
    maxConcurrent,
    os.cpus().length - 1,
    tracks.length
  );
  const results = [];
  const errors = [];
  let completedTracks = 0;
  let inProgress = new Set();

  // Process tracks in batches
  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize);
    const batchPromises = batch.map(async (track, batchIndex) => {
      const index = i + batchIndex;
      try {
        inProgress.add(index);

        // Send progress update for current track
        const progress = Math.round((completedTracks / tracks.length) * 100);
        const progressData = {
          name: track.name,
          artist: track.artist,
          currentTrack: index + 1,
          totalTracks: tracks.length,
        };

        // Send initial status for this track
        sendStatus(progressId, "downloading", progress, progressData);

        // Search for video
        const searchQuery = `${track.name} ${track.artist}`;
        const videoUrl = await new Promise((resolve, reject) => {
          const ytDlpSearch = spawn("yt-dlp", [
            "ytsearch1:" + searchQuery,
            "--get-id",
            "--no-warnings",
          ]);

          let videoId = "";
          let error = "";

          ytDlpSearch.stdout.on("data", (data) => {
            videoId += data.toString().trim();
          });

          ytDlpSearch.stderr.on("data", (data) => {
            error += data.toString();
          });

          ytDlpSearch.on("close", (code) => {
            if (code === 0 && videoId) {
              resolve(`https://www.youtube.com/watch?v=${videoId}`);
            } else {
              reject(new Error(`Search failed: ${error}`));
            }
          });
        });

        // Download track
        const sanitizedName = track.name.replace(/[^a-zA-Z0-9]/g, "_");
        const outputPath = path.join(
          playlistDir,
          `${index + 1}-${sanitizedName}.mp3`
        );

        await new Promise((resolve, reject) => {
          const ytDlp = spawn("yt-dlp", [
            "-f",
            "bestaudio",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "-o",
            outputPath,
            videoUrl,
          ]);

          let error = "";

          ytDlp.stdout.on("data", (data) => {
            console.log(`yt-dlp output for ${track.name}:`, data.toString());
          });

          ytDlp.stderr.on("data", (data) => {
            error += data.toString();
          });

          ytDlp.on("close", (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
              resolve();
            } else {
              reject(new Error(`Download failed (code ${code}): ${error}`));
            }
          });
        });

        completedTracks++;
        inProgress.delete(index);

        results.push({
          name: track.name,
          path: outputPath,
          success: true,
        });

        // Send completion status for current track
        sendStatus(
          progressId,
          "completed",
          Math.round((completedTracks / tracks.length) * 100),
          progressData
        );
      } catch (error) {
        console.error(`Error processing track ${track.name}:`, error);
        inProgress.delete(index);
        errors.push({ track, error: error.message });
        results.push({
          name: track.name,
          success: false,
          error: error.message,
        });

        // Send error status for this track
        sendStatus(
          progressId,
          "error",
          Math.round((completedTracks / tracks.length) * 100),
          {
            name: track.name,
            error: error.message,
            currentTrack: index + 1,
            totalTracks: tracks.length,
          }
        );
      }
    });

    // Wait for current batch to complete
    await Promise.all(batchPromises);
  }

  return { results, errors };
}

// Update the download-playlist endpoint to use parallel processing
app.post("/api/download-playlist", async (req, res) => {
  const { tracks, playlistName, progressId } = req.body;
  const actualProgressId = progressId || Date.now().toString();
  const playlistDir = path.join(downloadsDir, `playlist-${actualProgressId}`);

  try {
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
      throw new Error("No tracks provided");
    }

    console.log(
      `Starting playlist download with progress ID: ${actualProgressId}`
    );

    // Create playlist directory
    await fs.promises.mkdir(playlistDir, { recursive: true });

    // Process tracks in parallel
    const { results, errors } = await processTracksInParallel(
      tracks,
      playlistDir,
      actualProgressId
    );

    // Check if any tracks were downloaded successfully
    const successfulDownloads = results.filter((r) => r.success);
    if (successfulDownloads.length === 0) {
      throw new Error("No tracks were downloaded successfully");
    }

    // Send status update for creating zip
    sendStatus(actualProgressId, "creating_zip", 100, {
      message: "Creating zip file...",
    });

    // Create zip file
    const zipPath = path.join(playlistDir, "playlist.zip");
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    await new Promise((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);

      // Add successfully downloaded tracks to zip
      for (const result of successfulDownloads) {
        if (fs.existsSync(result.path)) {
          archive.file(result.path, { name: `${result.name}.mp3` });
        }
      }

      archive.finalize();
    });

    // Send completion status
    sendStatus(actualProgressId, "complete", 100, {
      message: "Download complete!",
      errors:
        errors.length > 0 ? `Failed to download ${errors.length} tracks` : null,
    });

    // Read and send zip file
    const fileBuffer = await fs.promises.readFile(zipPath);
    const safeFilename = sanitizeFilename(playlistName || "playlist");

    res.set({
      "Content-Type": "application/zip",
      "Content-Length": fileBuffer.length,
      "Content-Disposition": `attachment; filename="${safeFilename}.zip"`,
    });

    res.send(fileBuffer);
  } catch (err) {
    console.error("Playlist download error:", err);
    sendStatus(actualProgressId, "error", null, {
      error: err.message,
    });
    if (fs.existsSync(playlistDir)) {
      await fs.promises.rm(playlistDir, { recursive: true, force: true });
    }
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

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

// Add this helper function at the top with other functions
function sanitizeFilename(filename) {
  // Remove or replace invalid characters
  return filename
    .replace(/[^a-zA-Z0-9-_. ]/g, "") // Remove any characters that aren't alphanumeric, dash, underscore, dot, or space
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .trim(); // Remove leading/trailing spaces
}

// Function to extract YouTube video ID
function extractYoutubeId(url) {
  const regExp =
    /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[7].length === 11 ? match[7] : null;
}

// Add YouTube info endpoint
app.post("/api/youtube-info", async (req, res) => {
  let ytDlp = null;
  try {
    const { url } = req.body;
    const videoId = extractYoutubeId(url);
    if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

    // Get video info using yt-dlp
    const result = await new Promise((resolve, reject) => {
      ytDlp = spawn("yt-dlp", [
        "-j", // Output video info as JSON
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);

      let output = "";
      let error = "";

      ytDlp.stdout.on("data", (data) => {
        output += data;
      });

      ytDlp.stderr.on("data", (data) => {
        error += data;
      });

      ytDlp.on("close", (code) => {
        if (code === 0 && output) {
          try {
            const info = JSON.parse(output);
            resolve({
              title: info.title,
              author: info.uploader,
              thumbnail: info.thumbnail,
              duration: info.duration,
              formats: info.formats,
            });
          } catch (e) {
            reject(new Error("Failed to parse video info"));
          }
        } else {
          reject(new Error(error || "Failed to get video info"));
        }
      });
    });

    res.json(result);
  } catch (err) {
    console.error("Error getting video info:", err);
    if (ytDlp) ytDlp.kill("SIGKILL");
    res.status(500).json({ error: err.message });
  }
});

// Update YouTube download endpoint to handle resolution
app.post("/api/youtube-download", async (req, res) => {
  let ytDlp = null;
  let outputPath = null;
  let retryCount = 0;
  const MAX_RETRIES = 5;

  const downloadWithRetry = async () => {
    try {
      const { url, format, resolution } = req.body;
      const videoId = extractYoutubeId(url);
      if (!videoId)
        return res.status(400).json({ error: "Invalid YouTube URL" });

      const timestamp = Date.now();
      const extension = format === "audio" ? "mp3" : "mp4";
      const filename = `youtube-${timestamp}.${extension}`;
      outputPath = path.join(downloadsDir, filename);

      // Get args with proxy
      const ytDlpArgs = getYtDlpArgs(format, resolution);

      console.log("Starting download with args:", [
        ...ytDlpArgs,
        "-o",
        outputPath,
        `https://www.youtube.com/watch?v=${videoId}`,
      ]);

      // Download with proxy
      await new Promise((resolve, reject) => {
        ytDlp = spawn("yt-dlp", [
          ...ytDlpArgs,
          "-o",
          outputPath,
          `https://www.youtube.com/watch?v=${videoId}`,
        ]);

        let error = "";

        ytDlp.stdout.on("data", (data) => {
          console.log(`yt-dlp output: ${data}`);
        });

        ytDlp.stderr.on("data", (data) => {
          console.error(`yt-dlp error: ${data}`);
          error += data.toString();
        });

        ytDlp.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Download failed with code ${code}: ${error}`));
          }
        });
      });

      // Check if file exists and has size
      if (!fs.existsSync(outputPath)) {
        throw new Error("Download failed - file not created");
      }

      const stats = fs.statSync(outputPath);
      if (stats.size === 0) {
        throw new Error("Download failed - file is empty");
      }

      console.log("Download completed successfully");

      // Read the file into memory
      const fileBuffer = await fs.promises.readFile(outputPath);

      // Delete the file immediately after reading
      await fs.promises.unlink(outputPath);
      console.log("File deleted after reading into memory");

      // Set headers
      const contentType = format === "audio" ? "audio/mpeg" : "video/mp4";
      res.set({
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length,
        "Content-Disposition": `attachment; filename="youtube-download.${extension}"`,
      });

      // Send the file from memory
      res.send(fileBuffer);
    } catch (err) {
      console.error(`Download attempt ${retryCount + 1} failed:`, err);
      if (
        retryCount < MAX_RETRIES &&
        (err.message.includes("HTTP Error 429") ||
          err.message.includes("Unable to download") ||
          err.message.includes("Proxy error"))
      ) {
        retryCount++;
        console.log(`Retrying download (attempt ${retryCount + 1})...`);
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retryCount) * 1000)
        );
        return downloadWithRetry();
      }
      throw err;
    }
  };

  try {
    await downloadWithRetry();
  } catch (err) {
    console.error("All download attempts failed:", err);
    if (ytDlp) ytDlp.kill("SIGKILL");
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// Add error handling for cloud environments
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  // Implement your error reporting service here
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  // Implement your error reporting service here
});

// Update the port configuration
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await installPrerequisites();
    app.listen(PORT, HOST, () => {
      console.log(`Server running on ${PORT}`);
      console.log("Node environment:", process.env.NODE_ENV);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();
