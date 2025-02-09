import React, { useState, useEffect } from "react";
import {
  Container,
  TextField,
  Button,
  Card,
  CardContent,
  Typography,
  Box,
  CircularProgress,
  InputAdornment,
  CardMedia,
  MenuItem,
} from "@mui/material";
import axios from "axios";
import YouTubeIcon from "@mui/icons-material/YouTube";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import VideoFileIcon from "@mui/icons-material/VideoFile";
import "./styles/Banner.css";
import DownloadProgress from "./components/DownloadProgress";
import AdBanner from "./components/AdBanner";
import { adsConfig } from "./config/ads";

function App() {
  const [url, setUrl] = useState("");
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState(null);
  const [isYouTube, setIsYouTube] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedResolution, setSelectedResolution] = useState("720p");
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [adsLoaded, setAdsLoaded] = useState(false);

  const resolutionOptions = [
    { label: "360p", value: "360" },
    { label: "480p", value: "480" },
    { label: "720p", value: "720" },
    { label: "1080p", value: "1080" },
  ];

  const isYouTubeUrl = (url) => {
    return url.includes("youtube.com/") || url.includes("youtu.be/");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError(null);
    setContent(null);
    setVideoInfo(null);

    try {
      if (isYouTube) {
        const response = await axios.post("/api/youtube-info", { url });
        setVideoInfo(response.data);
      } else {
        const response = await axios.post("/api/info", { url });
        setContent(response.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const triggerDownload = (url, filename) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownload = async (track) => {
    try {
      setLoading(true);
      setError(null);
      setDownloadStatus(
        "Preparing download... this make take some time please wait"
      );

      const response = await axios({
        url: "/api/download",
        method: "POST",
        data: {
          track_name: track.name,
          artist_name: track.artist,
        },
        responseType: "blob",
        headers: {
          Accept: "audio/mpeg",
        },
      });

      if (response.data.size === 0) {
        throw new Error("Received empty file");
      }

      const blob = new Blob([response.data], { type: "audio/mpeg" });
      const downloadUrl = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${track.name}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(downloadUrl);
      setDownloadStatus("Download complete!");
      setTimeout(() => setDownloadStatus(null), 3000);
    } catch (err) {
      console.error("Download error:", err);
      setError(err.response?.data?.error || "Download failed");
      setDownloadStatus("Download failed");
    } finally {
      setLoading(false);
    }
  };

  const handleYouTubeDownload = async (format) => {
    try {
      setLoading(true);
      setError(null);
      setDownloadStatus(
        "Preparing for download... This May Take Some Time Please Wait"
      );

      const response = await axios({
        url: "/api/youtube-download",
        method: "POST",
        data: {
          url,
          format,
          resolution: format === "video" ? selectedResolution : null,
        },
        responseType: "blob",
        headers: {
          Accept: format === "audio" ? "audio/mpeg" : "video/mp4",
        },
      });

      if (response.data.size === 0) {
        throw new Error("Received empty file");
      }

      const blob = new Blob([response.data], {
        type: format === "audio" ? "audio/mpeg" : "video/mp4",
      });
      const downloadUrl = window.URL.createObjectURL(blob);
      const filename = `youtube-download.${format === "audio" ? "mp3" : "mp4"}`;

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(downloadUrl);
      setDownloadStatus("Download complete!");
      setTimeout(() => setDownloadStatus(null), 3000);
    } catch (err) {
      console.error("Download error:", err);
      setError(err.response?.data?.error || "Download failed");
      setDownloadStatus("Download failed");
    } finally {
      setLoading(false);
    }
  };

  const handleUrlChange = (event) => {
    const newUrl = event.target.value;
    setUrl(newUrl);
    setIsYouTube(isYouTubeUrl(newUrl));
    setContent(null);
    setError(null);
    setDownloadStatus(null);
  };

  const downloadPlaylist = async (tracks, playlistName) => {
    let eventSource = null;
    const progressId = Date.now().toString();

    // Reset progress state
    setDownloadProgress(null);
    setDownloadStatus(null);
    setError(null);

    // Add cleanup function for window unload
    const handleUnload = async () => {
      if (eventSource) {
        eventSource.close();
        try {
          await axios.post(`/api/download-playlist/${progressId}/abort`);
        } catch (error) {
          console.error("Error aborting download:", error);
        }
      }
    };

    // Add event listeners for window unload
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("unload", handleUnload);

    try {
      setLoading(true);
      setDownloadStatus("Preparing playlist download...");

      // Create EventSource with the correct URL
      const baseUrl =
        process.env.NODE_ENV === "production"
          ? process.env.REACT_APP_API_URL
          : "http://localhost:3000";

      eventSource = new EventSource(
        `${baseUrl}/api/download-progress/${progressId}`,
        {
          withCredentials: true,
        }
      );

      // Handle connection open
      eventSource.onopen = () => {
        console.log("EventSource connection established");
      };

      // Handle messages
      eventSource.onmessage = (event) => {
        try {
          console.log("Raw event data:", event.data);
          const data = JSON.parse(event.data);
          console.log("Parsed progress data:", data);

          if (data.status === "connected") {
            console.log("Initial connection established");
            return;
          }

          // Update progress state
          console.log("Setting download progress:", data);
          setDownloadProgress(data);

          // Update status message based on current state
          if (data.status === "downloading" || data.status === "extracting") {
            const trackInfo = data.currentTrack;
            if (trackInfo) {
              console.log("Track info:", trackInfo);
              setDownloadStatus(
                `${
                  data.status === "downloading" ? "Downloading" : "Processing"
                }: ${trackInfo.name || "..."} (${trackInfo.currentTrack}/${
                  trackInfo.totalTracks
                })`
              );
            }
          } else if (data.status === "creating_zip") {
            setDownloadStatus("Creating zip file...");
          } else if (data.status === "complete") {
            setDownloadStatus("Download complete!");
            eventSource.close();
            setTimeout(() => {
              setDownloadStatus(null);
              setDownloadProgress(null);
            }, 3000);
          } else if (data.status === "error") {
            setError(data.error || "Download failed");
            setDownloadStatus("Download failed");
            eventSource.close();
          }
        } catch (error) {
          console.error("Error parsing progress data:", error, event.data);
          setError("Error processing progress update");
        }
      };

      // Handle errors
      eventSource.onerror = (error) => {
        console.error("EventSource error:", error);
        setError("Connection error occurred");
        setDownloadStatus("Download failed");
        eventSource.close();
      };

      // Make the download request
      const response = await axios({
        url: `${baseUrl}/api/download-playlist`,
        method: "POST",
        data: {
          tracks,
          playlistName,
          progressId,
        },
        responseType: "blob",
        headers: {
          Accept: "application/zip",
        },
        withCredentials: true,
      });

      if (response.data.size === 0) {
        throw new Error("Received empty file");
      }

      // Handle successful download
      const blob = new Blob([response.data], { type: "application/zip" });
      const downloadUrl = window.URL.createObjectURL(blob);
      triggerDownload(downloadUrl, `${playlistName || "playlist"}.zip`);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Download error:", error);
      setError(error.response?.data?.error || "Download failed");
      setDownloadStatus("Download failed");
    } finally {
      setLoading(false);
      // Clean up event listeners
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("unload", handleUnload);
      // Ensure EventSource is closed
      if (eventSource) {
        console.log("Closing EventSource in finally block");
        eventSource.close();
      }
    }
  };

  useEffect(() => {
    const cleanup = () => {
      // Clean up any ad-related resources
      Object.values(adsConfig).forEach((ad) => {
        if (ad.image && ad.image.startsWith("http")) {
          // Remove image from browser cache if needed
          const img = new Image();
          img.src = ad.image;
          img.onload = () => URL.revokeObjectURL(img.src);
        }
      });
    };

    // Set ads as loaded
    setAdsLoaded(true);

    // Return cleanup function
    return () => {
      cleanup();
      setAdsLoaded(false);
    };
  }, []);

  return (
    <div>
      {adsLoaded && (
        <>
          <AdBanner position="left" adContent={adsConfig.left} />
          <AdBanner position="right" adContent={adsConfig.right} />
        </>
      )}

      <div className="main-content">
        <Container maxWidth="sm" sx={{ mt: 4 }}>
          <Typography variant="h4" component="h1" gutterBottom align="center">
            Spotify & YouTube Downloader
          </Typography>

          {downloadProgress && (
            <Box sx={{ mb: 3 }}>
              <DownloadProgress
                status={downloadProgress.status}
                progress={downloadProgress.progress}
                currentTrack={downloadProgress.currentTrack?.currentTrack}
                totalTracks={downloadProgress.currentTrack?.totalTracks}
                trackName={downloadProgress.currentTrack?.name}
              />
            </Box>
          )}

          <form onSubmit={handleSubmit}>
            <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                label={isYouTube ? "YouTube URL" : "Spotify URL"}
                variant="outlined"
                value={url}
                onChange={handleUrlChange}
                disabled={loading}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      {isYouTube ? (
                        <YouTubeIcon color="error" />
                      ) : (
                        <YouTubeIcon color="disabled" />
                      )}
                    </InputAdornment>
                  ),
                }}
                error={!!error}
                helperText={error}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={loading}
                sx={{ minWidth: "100px" }}
              >
                {loading ? <CircularProgress size={24} /> : "Search"}
              </Button>
            </Box>
          </form>

          {downloadStatus && (
            <Typography
              variant="body2"
              color="text.secondary"
              align="center"
              sx={{ mt: 2, mb: 2 }}
            >
              {downloadStatus}
            </Typography>
          )}

          {videoInfo && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                {videoInfo.thumbnail && (
                  <CardMedia
                    component="img"
                    height="300"
                    image={videoInfo.thumbnail}
                    alt={videoInfo.title}
                    sx={{ objectFit: "contain" }}
                  />
                )}
                <Typography variant="h6" component="div">
                  {videoInfo.title}
                </Typography>
                <Typography color="text.secondary">
                  {videoInfo.author}
                </Typography>
                <Box
                  sx={{
                    mt: 2,
                    display: "flex",
                    gap: 2,
                    flexDirection: "column",
                  }}
                >
                  <Box
                    sx={{ display: "flex", gap: 2, justifyContent: "center" }}
                  >
                    <Button
                      variant="contained"
                      startIcon={<AudioFileIcon />}
                      onClick={() => handleYouTubeDownload("audio")}
                      disabled={loading || !url}
                    >
                      Download MP3
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={<VideoFileIcon />}
                      onClick={() => handleYouTubeDownload("video")}
                      disabled={loading || !url}
                    >
                      Download Video
                    </Button>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "center" }}>
                    <TextField
                      select
                      label="Video Quality"
                      value={selectedResolution}
                      onChange={(e) => setSelectedResolution(e.target.value)}
                      disabled={loading}
                      sx={{ width: "200px" }}
                    >
                      {resolutionOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          )}

          {content && !isYouTube && (
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
                      disabled={loading}
                    >
                      {loading ? "Downloading..." : "Download"}
                    </Button>
                  </>
                ) : content.type === "playlist" ? (
                  <>
                    <Typography variant="h6" component="div" gutterBottom>
                      {content.name}
                    </Typography>
                    <Button
                      variant="contained"
                      onClick={() =>
                        downloadPlaylist(content.tracks, content.name)
                      }
                      sx={{ mb: 2 }}
                      disabled={loading}
                    >
                      {loading ? "Downloading..." : "Download Entire Playlist"}
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
                          disabled={loading}
                        >
                          {loading ? "Downloading..." : "Download"}
                        </Button>
                      </Box>
                    ))}
                  </>
                ) : null}
              </CardContent>
            </Card>
          )}
        </Container>
      </div>
    </div>
  );
}

export default App;
