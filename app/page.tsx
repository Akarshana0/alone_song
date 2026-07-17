"use client";

import { useEffect } from "react";
import Navbar from "@/components/Navbar";
import Transport from "@/components/Transport";
import EditToolbar from "@/components/EditToolbar";
import WorkflowBar from "@/components/WorkflowBar";
import ChordTempoBar from "@/components/ChordTempoBar";
import Timeline from "@/components/Timeline";
import Mixer from "@/components/Mixer";
import ExportPanel from "@/components/ExportPanel";
import TrackTemplatesPanel from "@/components/TrackTemplatesPanel";
import MacrosPanel from "@/components/MacrosPanel";
import CloudSyncPanel from "@/components/CloudSyncPanel";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useDAWStore } from "@/store/useDAWStore";

export default function DAWPage() {
  useAudioEngine();
  const tracks = useDAWStore((s) => s.tracks);
  const addTrack = useDAWStore((s) => s.addTrack);

  // Seed with one empty audio track on first load so the UI never looks bare.
  useEffect(() => {
    if (tracks.length === 0) addTrack("audio");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-void-950 text-white">
      <Navbar />
      <Transport />
      <EditToolbar />
      <WorkflowBar />
      <ChordTempoBar />
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <Timeline />
        <Mixer />
      </div>
      <ExportPanel />
      <TrackTemplatesPanel />
      <MacrosPanel />
      <CloudSyncPanel />
    </main>
  );
}
