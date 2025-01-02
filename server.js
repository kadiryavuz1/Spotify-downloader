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
        const playlist = await spotifyApi.getPlaylist(id, {
          fields: "name",
        });
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
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/download", async (req, res) => {
  let ytDlp = null;
  let outputPath = null;

  try {
    const { track_name, artist_name } = req.body;
    console.log("Starting download process for:", { track_name, artist_name });

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

    // Encode filename for Content-Disposition header
    const encodedFilename = encodeURIComponent(track_name).replace(
      /['()]/g,
      escape
    );

    // Set headers with properly encoded filename
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": stats.size,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}.mp3`,
    });

    // Stream the file
    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      // Clean up the file after streaming
      fs.unlink(outputPath, (err) => {
        if (err) console.error("Error deleting file:", err);
        else console.log("Temporary file deleted successfully");
      });
    });

    // Handle client disconnect
    req.on("close", () => {
      if (ytDlp) {
        console.log("Client disconnected, killing yt-dlp process");
        ytDlp.kill("SIGKILL");
      }
      if (outputPath && fs.existsSync(outputPath)) {
        console.log("Cleaning up partial download file");
        fs.unlink(outputPath, (err) => {
          if (err) console.error("Error deleting partial file:", err);
          else console.log("Partial file deleted successfully");
        });
      }
    });
  } catch (err) {
    console.error("Download error:", err);
    if (ytDlp) ytDlp.kill("SIGKILL");
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
  const progressId = Date.now().toString();
  const playlistDir = path.join(downloadsDir, `playlist-${progressId}`);

  try {
    const { tracks, playlistName } = req.body;
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
      throw new Error("No tracks provided");
    }

    // Create playlist directory
    await fs.promises.mkdir(playlistDir, { recursive: true });

    // Process tracks sequentially to avoid overwhelming the system
    const downloadedTracks = [];
    for (const [index, track] of tracks.entries()) {
      try {
        console.log(
          `Processing track ${index + 1}/${tracks.length}: ${track.name}`
        );

        const searchQuery = `${track.name} ${track.artist} audio`;
        const searchResponse = await axios.get(
          `https://www.youtube.com/results?search_query=${encodeURIComponent(
            searchQuery
          )}`
        );

        const match = searchResponse.data.match(/videoId":"([^"]+)"/);
        if (!match) continue;

        const videoId = match[1];
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const sanitizedName = track.name.replace(/[^a-zA-Z0-9]/g, "_");
        const outputPath = path.join(
          playlistDir,
          `${index + 1}-${sanitizedName}.mp3`
        );

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
            "--no-progress", // Remove progress output
            "-o",
            outputPath,
            videoUrl,
          ]);

          let error = "";

          ytDlp.stderr.on("data", (data) => {
            error += data.toString();
          });

          ytDlp.on("close", (code) => {
            if (code === 0 && fs.existsSync(outputPath)) {
              downloadedTracks.push({
                name: track.name,
                path: outputPath,
              });
              resolve();
            } else {
              reject(new Error(`Download failed (code ${code}): ${error}`));
            }
          });
        });
      } catch (error) {
        console.error(`Error downloading track ${track.name}:`, error);
      }
    }

    // Create download endpoints for successful downloads
    downloadedTracks.forEach((track, index) => {
      const endpoint = `/api/download-playlist/${progressId}/track/${index}`;
      app.get(endpoint, (req, res) => {
        const stats = fs.statSync(track.path);
        const encodedFilename = encodeURIComponent(track.name).replace(
          /['()]/g,
          escape
        );

        res.set({
          "Content-Type": "audio/mpeg",
          "Content-Length": stats.size,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}.mp3`,
        });

        fs.createReadStream(track.path).pipe(res);
      });
    });

    // Send download URLs to client
    res.json({
      tracks: downloadedTracks.map((track, index) => ({
        name: track.name,
        url: `/api/download-playlist/${progressId}/track/${index}`,
      })),
    });

    // Clean up after 5 minutes
    setTimeout(async () => {
      try {
        await fs.promises.rm(playlistDir, { recursive: true, force: true });
        console.log("Cleanup completed successfully");
      } catch (err) {
        console.error("Error during cleanup:", err);
      }
    }, 300000);
  } catch (err) {
    console.error("Playlist download error:", err);
    // Clean up on error
    if (fs.existsSync(playlistDir)) {
      await fs.promises.rm(playlistDir, { recursive: true, force: true });
    }
    res.status(500).json({ error: err.message });
  }
});

// Add this function to extract YouTube video ID
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

  try {
    const { url, format, resolution } = req.body;
    const videoId = extractYoutubeId(url);
    if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

    const timestamp = Date.now();
    const extension = format === "audio" ? "mp3" : "mp4";
    const filename = `youtube-${timestamp}.${extension}`;
    outputPath = path.join(downloadsDir, filename);

    // Updated arguments for better video quality and format selection
    const ytDlpArgs =
      format === "audio"
        ? [
            "-f",
            "bestaudio",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
          ]
        : [
            "-f",
            `bestvideo[height<=${resolution}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${resolution}][ext=mp4]/best[ext=mp4]`,
            "--merge-output-format",
            "mp4",
          ];

    console.log("Starting download with args:", [
      ...ytDlpArgs,
      "-o",
      outputPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    // First, download the file completely
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

    // Then stream it to the client
    const contentType = format === "audio" ? "audio/mpeg" : "video/mp4";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="youtube-download.${extension}"`,
      "Content-Length": stats.size,
    });

    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      // Clean up the file after streaming
      fs.unlink(outputPath, (err) => {
        if (err) console.error("Error deleting file:", err);
        else console.log("Temporary file deleted successfully");
      });
    });

    // Handle client disconnect
    req.on("close", () => {
      if (ytDlp) {
        console.log("Client disconnected, killing yt-dlp process");
        ytDlp.kill("SIGKILL");
      }
      if (outputPath && fs.existsSync(outputPath)) {
        console.log("Cleaning up partial download file");
        fs.unlink(outputPath, (err) => {
          if (err) console.error("Error deleting partial file:", err);
          else console.log("Partial file deleted successfully");
        });
      }
    });
  } catch (err) {
    console.error("Download error:", err);
    if (ytDlp) ytDlp.kill("SIGKILL");
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
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
