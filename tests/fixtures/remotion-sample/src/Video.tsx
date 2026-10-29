import { AbsoluteFill, Img, Series, staticFile } from 'remotion';
import { Title } from './Title';

export const Video: React.FC<{ title: string }> = ({ title }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#0f172a' }}>
      <Series>
        <Series.Sequence durationInFrames={90} name="Intro">
          <h1>{title}</h1>
          <Img src={staticFile('logo.png')} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={60} name="Kits">
          <Title text="Brand kits in one click" />
        </Series.Sequence>
        <Series.Sequence durationInFrames={120} name="Render">
          <p>Render on your own machine</p>
          <p>{'Approve every storyboard first'}</p>
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
