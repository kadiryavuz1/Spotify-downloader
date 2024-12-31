import React, { useState, useRef } from "react";
import {
  Container,
  TextField,
  Button,
  Typography,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Alert,
} from "@mui/material";
import { CloudDownload } from "@mui/icons-material";
import ReCAPTCHA from "react-google-recaptcha";
import axios from "axios";

// Configure axios
const api = axios.create({
  baseURL: "http://localhost:5000",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Enable credentials
});

function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState(null);
  const [captchaToken, setCaptchaToken] = useState(null);
  const recaptchaRef = useRef();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!captchaToken) {
      setError("Please complete the reCAPTCHA verification");
      return;
    }

    setLoading(true);
    setError("");
    setContent(null);

    try {
      const response = await api.post("/api/info", {
        url,
        recaptchaToken: captchaToken,
      });

      if (response.data.error) {
        setError(response.data.error);
      } else {
        setContent(response.data);
      }
    } catch (err) {
      console.error("Error:", err);
      if (err.response) {
        setError(err.response.data?.error || "Server error occurred");
      } else if (err.request) {
        setError("Could not connect to server");
      } else {
        setError("An error occurred");
      }
    } finally {
      setLoading(false);
      setCaptchaToken(null);
      recaptchaRef.current.reset();
    }
  };

  const handleDownload = async (track) => {
    if (!captchaToken) {
      setError("Please complete the reCAPTCHA verification");
      return;
    }

    try {
      const response = await api.post("/api/download", {
        track_name: track.name,
        artist_name: track.artist,
        recaptchaToken: captchaToken,
      });

      if (response.data.success) {
        alert("Download started! Check the downloads folder.");
      }
    } catch (err) {
      console.error("Download error:", err);
      setError(err.response?.data?.error || "Download failed");
    } finally {
      setCaptchaToken(null);
      recaptchaRef.current.reset();
    }
  };

  const handleCaptchaChange = (token) => {
    console.log("Captcha token received");
    setCaptchaToken(token);
    setError("");
  };

  const renderContent = () => {
    if (!content) return null;

    if (content.type === "track") {
      return (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6">{content.info.name}</Typography>
            <Typography color="textSecondary">{content.info.artist}</Typography>
            <Typography color="textSecondary">{content.info.album}</Typography>
            <Button
              variant="contained"
              startIcon={<CloudDownload />}
              onClick={() => handleDownload(content.info)}
              sx={{ mt: 2 }}
            >
              Download
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {content.type === "playlist" ? "Playlist Tracks" : "Album Tracks"}
        </Typography>
        {content.tracks.map((track, index) => (
          <Card key={track.id} sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6">{track.name}</Typography>
              <Typography color="textSecondary">{track.artist}</Typography>
              {track.album && (
                <Typography color="textSecondary">{track.album}</Typography>
              )}
              <Button
                variant="contained"
                startIcon={<CloudDownload />}
                onClick={() => handleDownload(track)}
                sx={{ mt: 2 }}
              >
                Download
              </Button>
            </CardContent>
          </Card>
        ))}
      </Box>
    );
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h3" component="h1" align="center" gutterBottom>
        Spotify Downloader
      </Typography>
      <Typography
        variant="subtitle1"
        align="center"
        color="textSecondary"
        sx={{ mb: 4 }}
      >
        Download your favorite music from Spotify
      </Typography>

      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ textAlign: "center" }}
      >
        <TextField
          fullWidth
          label="Spotify URL"
          variant="outlined"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste Spotify track, album, or playlist URL"
          sx={{ mb: 2 }}
        />
        <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
          <ReCAPTCHA
            ref={recaptchaRef}
            sitekey="6Lew6qkqAAAAALjxLwzAWmpbkQjhkNeK_5nJ5B78"
            onChange={handleCaptchaChange}
          />
        </Box>
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={loading || !captchaToken}
          startIcon={
            loading ? <CircularProgress size={20} /> : <CloudDownload />
          }
        >
          Get Info
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mt: 3 }}>
          {error}
        </Alert>
      )}

      {renderContent()}
    </Container>
  );
}

export default App;
