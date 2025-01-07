import React, { memo } from "react";
import { Button } from "@mui/material";

const DownloadButton = memo(({ onClick, loading, text }) => (
  <Button variant="contained" onClick={onClick} disabled={loading}>
    {loading ? "Downloading..." : text}
  </Button>
));

export default DownloadButton;
