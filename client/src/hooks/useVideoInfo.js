import { useQuery } from "react-query";
import axios from "axios";

export function useVideoInfo(url) {
  return useQuery(
    ["videoInfo", url],
    async () => {
      const response = await axios.post("/api/youtube-info", { url });
      return response.data;
    },
    {
      enabled: !!url,
      cacheTime: 1000 * 60 * 5, // Cache for 5 minutes
      staleTime: 1000 * 60 * 2, // Consider data stale after 2 minutes
    }
  );
}
