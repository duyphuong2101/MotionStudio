import { Audio, Img, Sequence, Video, staticFile } from 'remotion';

// <h1>Old headline we dropped</h1>
export const Outro: React.FC = () => (
  <Sequence from={30} durationInFrames={45} name="Outro">
    <h2>Try it on your next launch</h2>
    <Audio src={staticFile('../outside.png')} />
    <Audio src={staticFile('notes.txt')} />
    <Img src={staticFile('linked/secret.png')} />
    <Video src="https://example.com/clip.mp4" />
  </Sequence>
);
