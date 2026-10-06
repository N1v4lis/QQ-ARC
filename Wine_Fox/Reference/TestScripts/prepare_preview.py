from pathlib import Path
root=Path(__file__).parent
for direction in ('left_to_right','right_to_left','both'):
    directions=('left_to_right','right_to_left') if direction=='both' else (direction,)
    entries=[f"file 'frames/{d}-{f:03}.png'\nduration {2/30}\n" for d in directions for f in range(0,20,2)]
    entries.append(f"file 'frames/{directions[-1]}-020.png'\n")
    filename='preview-frames.txt' if direction=='both' else f'preview-{direction}-frames.txt'
    (root/filename).write_text(''.join(entries),encoding='utf-8')
