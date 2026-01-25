export interface Env {
  USER_DATA: R2Bucket;
  ENVIRONMENT: string;
}

export interface Game {
  id: number;
  name: string;
  video_path: string | null;
  thumbnail_path: string | null;
  duration: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  opponent_name: string | null;
  game_date: string | null;
  game_type: string;
  tournament_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawClip {
  id: number;
  game_id: number;
  video_path: string;
  start_time: number;
  end_time: number;
  rating: number;
  tags: string;
  notes: string | null;
  thumbnail_path: string | null;
  created_at: string;
}

export interface Project {
  id: number;
  name: string;
  aspect_ratio: string;
  output_width: number;
  output_height: number;
  is_auto_created: number;
  working_video_path: string | null;
  has_working_video: number;
  has_overlay_edits: number;
  has_final_video: number;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}

export interface WorkingClip {
  id: number;
  project_id: number;
  raw_clip_id: number;
  clip_index: number;
  crop_keyframes: string;
  is_exported: number;
  exported_path: string | null;
  created_at: string;
}

export interface FinalVideo {
  id: number;
  project_id: number | null;
  game_id: number | null;
  name: string;
  video_path: string;
  thumbnail_path: string | null;
  source_type: string;
  duration: number | null;
  file_size: number | null;
  created_at: string;
}
