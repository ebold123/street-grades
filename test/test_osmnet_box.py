from osmnet_box import join_lat_lng, without_walking_paths
import pandas as pd


class TestOSMNetBox:
    def setup(self):
        self.a = pd.DataFrame(
            {
                "id": [258912711, 65280106, 1583149816, 420508875],
                "x": [37.765743900000004, 37.7639075, 37.7621422, 37.762106],
                "y": [
                    -122.46967409999999,
                    -122.46954579999999,
                    -122.4694227,
                    -122.46942,
                ],
            }
        )
        self.b = pd.DataFrame(
            {
                "": [0, 1, 2],
                "from": [258912711, 65280106, 1583149816],
                "to": [65280106, 1583149816, 420508875],
                "name": ["RoadA", "StreetB", "AvenueC"],
                "highway": ["path", "footway", "residential"],
                "service": [""] * 3,
                "bridge": [""] * 3,
                "tunnel": [""] * 3,
                "access": [""] * 3,
            }
        )

        self.merged = pd.DataFrame(
            {
                "from": [258912711, 65280106, 1583149816],
                "to": [65280106, 1583149816, 420508875],
                "name": ["RoadA", "StreetB", "AvenueC"],
                "highway": ["path", "footway", "residential"],
                "service": [""] * 3,
                "bridge": [""] * 3,
                "tunnel": [""] * 3,
                "access": [""] * 3,
                "from_lat": [-122.46967409999999, -122.46954579999999, -122.4694227],
                "from_lng": [37.765743900000004, 37.7639075, 37.7621422],
                "to_lat": [-122.46954579999999, -122.4694227, -122.46942],
                "to_lng": [37.7639075, 37.7621422, 37.762106],
            }
        )

    def test_join_lat_lng(self):

        out = join_lat_lng(self.a, self.b)

        print(out.columns)
        print(self.merged.columns)

        assert set(out.columns) == set(self.merged.columns)

        for c in out.columns:
            print(c)
            print(out[c])
            print(self.merged[c])
            assert out[c].equals(self.merged[c])

        assert out.equals(self.merged)

    def test_without_walking_paths(self):

        r = without_walking_paths(self.b)

        assert 1 == len(r)
