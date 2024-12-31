import React, { useState, useEffect } from "react";
import {
  Container,
  TextField,
  Button,
  Typography,
  Card,
  CardContent,
  CardMedia,
  Box,
  CircularProgress,
  LinearProgress,
} from "@mui/material";
import axios from "axios";

function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [estimatedTime, setEstimatedTime] = useState(null);
  const [showProgress, setShowProgress] = useState(false);
  const [abortController, setAbortController] = useState(null);

  useEffect(() => {
    if (downloadProgress === 100) {
      const timer = setTimeout(() => {
        setShowProgress(false);
        setDownloadStatus(null);
        setCurrentTrack(null);
        setEstimatedTime(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [downloadProgress]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setContent(null);
    setDownloadProgress(0);
    setDownloadStatus(null);
    setCurrentTrack(null);

    try {
      const response = await axios.post("http://localhost:3000/api/info", {
        url,
      });
      setContent(response.data);
    } catch (err) {
      setError(err.response?.data?.error || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleAbort = () => {
    if (abortController) {
      abortController.abort();
      setDownloadStatus("Download aborted");
      setShowProgress(false);
      setTimeout(() => {
        setDownloadStatus(null);
        setCurrentTrack(null);
        setEstimatedTime(null);
        setDownloadProgress(0);
      }, 4000);
    }
  };

  const handleDownload = async (track) => {
    try {
      setShowProgress(true);
      setDownloadProgress(0);
      setDownloadStatus("Searching YouTube...");
      setCurrentTrack({ name: track.name, current: 1, total: 1 });
      setError("");

      const controller = new AbortController();
      setAbortController(controller);

      const response = await fetch("http://localhost:3000/api/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          track_name: track.name,
          artist_name: track.artist,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Download failed");
      }

      const reader = response.body.getReader();
      const contentLength = +response.headers.get("Content-Length") || 0;
      let receivedLength = 0;
      let chunks = [];

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        chunks.push(value);
        receivedLength += value.length;

        if (contentLength > 0) {
          const progress = (receivedLength / contentLength) * 100;
          setDownloadProgress(Math.round(progress));
        }
      }

      setDownloadStatus("Preparing download...");
      const blob = new Blob(chunks, { type: "audio/mpeg" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${track.name}.mp3`);
      document.body.appendChild(link);
      setDownloadStatus("Starting download...");
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setDownloadProgress(100);
      setDownloadStatus("Download complete!");
    } catch (err) {
      if (err.name === "AbortError") {
        setError("Download aborted");
      } else {
        setError("Download failed");
        console.error("Download error:", err);
      }
    } finally {
      setAbortController(null);
    }
  };

  const handleDownloadPlaylist = async () => {
    if (!content || content.type !== "playlist" || !content.tracks) return;

    try {
      setShowProgress(true);
      setDownloadProgress(0);
      setDownloadStatus("Preparing playlist download...");
      setError("");

      const controller = new AbortController();
      setAbortController(controller);

      // Start the download process and get the progress ID
      const response = await fetch(
        "http://localhost:3000/api/download-playlist",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tracks: content.tracks,
            playlistName: content.name,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        throw new Error("Playlist download failed");
      }

      const { progressId } = await response.json();

      // Connect to the progress endpoint
      const progressSource = new EventSource(
        `http://localhost:3000/api/download-progress/${progressId}`
      );

      // Create an abort handler that will close the EventSource
      const abortHandler = {
        abort: () => {
          progressSource.close();
          controller.abort();
          fetch(
            `http://localhost:3000/api/download-playlist/${progressId}/abort`,
            {
              method: "POST",
            }
          ).catch(console.error);
        },
      };
      setAbortController(abortHandler);

      progressSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === "error") {
          setError(data.error);
          progressSource.close();
          setAbortController(null);
          return;
        }

        if (data.status === "ready") {
          // Download is ready, get the file
          progressSource.close();
          setDownloadStatus("Starting download...");
          window.location.href = `http://localhost:3000${data.downloadUrl}`;
          setTimeout(() => {
            setShowProgress(false);
            setDownloadStatus(null);
            setCurrentTrack(null);
            setEstimatedTime(null);
          }, 4000);
          return;
        }

        if (data.status) setDownloadStatus(data.status);
        if (data.progress) setDownloadProgress(Math.round(data.progress));
        if (data.currentTrack) setCurrentTrack(data.currentTrack);
      };

      progressSource.onerror = () => {
        progressSource.close();
        setError("Lost connection to server");
        setAbortController(null);
      };
    } catch (err) {
      if (err.name === "AbortError") {
        setError("Download aborted");
      } else {
        setError("Playlist download failed");
        console.error("Playlist download error:", err);
      }
    }
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom align="center">
        Spotify Downloader
      </Typography>

      <form onSubmit={handleSubmit}>
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <TextField
            fullWidth
            label="Spotify URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            variant="outlined"
            error={!!error}
            helperText={error}
            disabled={showProgress}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loading || showProgress}
            sx={{ minWidth: "100px" }}
          >
            {loading ? <CircularProgress size={24} /> : "Search"}
          </Button>
        </Box>
      </form>

      {showProgress && (
        <Box sx={{ width: "100%", mb: 2 }}>
          <LinearProgress variant="determinate" value={downloadProgress} />
          <Box sx={{ mt: 1, mb: 1 }}>
            <Typography variant="body2" color="text.secondary" align="center">
              {downloadStatus}
            </Typography>
            {currentTrack && (
              <Typography variant="body2" color="text.secondary" align="center">
                Processing: {currentTrack.name} ({currentTrack.current}/
                {currentTrack.total})
              </Typography>
            )}
            {estimatedTime && (
              <Typography variant="body2" color="text.secondary" align="center">
                {estimatedTime}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" align="center">
              {Math.round(downloadProgress)}%
            </Typography>
          </Box>
          <Button
            variant="outlined"
            color="error"
            onClick={handleAbort}
            fullWidth
            disabled={!abortController}
          >
            Abort Download
          </Button>
        </Box>
      )}

      {content && (
        <Card sx={{ mt: 2 }}>
          <CardContent>
            {content.type === "track" ? (
              <>
                {content.info.image && (
                  <CardMedia
                    component="img"
                    height="300"
                    image={content.info.image}
                    alt={content.info.name}
                    sx={{ objectFit: "contain" }}
                  />
                )}
                <Typography variant="h6" component="div">
                  {content.info.name}
                </Typography>
                <Typography color="text.secondary">
                  {content.info.artist} - {content.info.album}
                </Typography>
                <Button
                  variant="contained"
                  onClick={() => handleDownload(content.info)}
                  sx={{ mt: 2 }}
                  disabled={showProgress}
                >
                  Download
                </Button>
              </>
            ) : content.type === "playlist" ? (
              <>
                <Typography variant="h6" component="div" gutterBottom>
                  {content.name}
                </Typography>
                <Button
                  variant="contained"
                  onClick={handleDownloadPlaylist}
                  sx={{ mb: 2 }}
                  disabled={showProgress}
                >
                  Download Entire Playlist
                </Button>
                {content.tracks.map((track, index) => (
                  <Box key={track.id} sx={{ mb: 2 }}>
                    <Typography variant="subtitle1">
                      {index + 1}. {track.name}
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      {track.artist} - {track.album}
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => handleDownload(track)}
                      sx={{ mt: 1 }}
                      disabled={showProgress}
                    >
                      Download
                    </Button>
                  </Box>
                ))}
              </>
            ) : null}
          </CardContent>
        </Card>
      )}
    </Container>
  );
}

export default App;
