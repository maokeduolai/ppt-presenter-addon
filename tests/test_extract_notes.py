import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('extract_notes', Path(__file__).resolve().parents[1] / 'tools/extract_notes.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractNotesTests(unittest.TestCase):
    def test_languages_and_content_are_not_classified(self):
        notes = module.parse_notes('## Slide 1 | Intro\n\n你好。Hello. مرحبا\n\n> Pause\n**Time:** optional text')
        self.assertEqual(notes, [{'title':'Intro', 'text':'你好。Hello. مرحبا\n\n> Pause\n**Time:** optional text'}])

    def test_chinese_headings_and_empty_notes(self):
        self.assertEqual(module.parse_notes('## 第 01 页｜开场\n## 第 02 页｜结束'), [{'title':'开场','text':''},{'title':'结束','text':''}])

    def test_invalid_sequence(self):
        for text in ('## Slide 2 | Gap', '## Slide 1 | One\n## Slide 1 | Duplicate', 'No pages'):
            with self.assertRaises(ValueError):
                module.parse_notes(text)

    def test_headings_in_fenced_examples_are_content(self):
        text = '## Slide 1 | One\n```md\n## Slide 7 | Example\n```\n## Slide 2 | Two\nEnd'
        self.assertEqual(len(module.parse_notes(text)), 2)
        self.assertIn('## Slide 7', module.parse_notes(text)[0]['text'])


if __name__ == '__main__':
    unittest.main()
