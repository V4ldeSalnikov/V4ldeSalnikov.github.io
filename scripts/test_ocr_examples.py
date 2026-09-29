from hashlib import sha256
from pathlib import Path
import tempfile
import unittest

from export_ocr_examples import SOURCES, checked_image, select_cases


class ExampleTests(unittest.TestCase):
    def test_selection_is_stable_and_independent_of_model_scores(self):
        cases = [{"name": str(i), "score": 0} for i in range(20)]
        selected = [case["name"] for case in select_cases(cases)]
        cases.reverse()
        for i, case in enumerate(cases):
            case["score"] = i * 100
        self.assertEqual(selected, [case["name"] for case in select_cases(cases)])
        self.assertEqual(len(selected), 3)

    def test_changed_or_outside_images_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            folder = root / "samples"
            folder.mkdir()
            (folder / "image.png").write_bytes(b"input")
            (root / "outside.png").write_bytes(b"input")
            case = {"image": "image.png", "image_sha256": sha256(b"input").hexdigest()}
            self.assertEqual(checked_image(folder, case), folder / "image.png")
            with self.assertRaises(AssertionError):
                checked_image(folder, {**case, "image": "../outside.png"})
            (folder / "image.png").write_bytes(b"modified")
            with self.assertRaises(AssertionError):
                checked_image(folder, case)

    def test_source_terms_are_recorded_without_inventing_a_license(self):
        self.assertEqual(SOURCES["riksarkivet-ood"][1], "License not stated by source")
        self.assertEqual(SOURCES["nasjonalt-vitenarkiv"][1], "CC0")


if __name__ == "__main__":
    unittest.main()
